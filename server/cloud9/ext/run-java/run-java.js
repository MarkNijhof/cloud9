/**
 * Java Runtime Module for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
var Path             = require("path"),
    Spawn            = require("child_process").spawn,
    Plugin           = require("cloud9/plugin"),
    sys              = require("sys"),
    netutil          = require("cloud9/netutil");

var JavaRuntimePlugin = module.exports = function(ide, workspace) {
    this.ide = ide;
    this.workspace = workspace;
    this.hooks = ["command"];
    this.name = "java-runtime";
};

sys.inherits(JavaRuntimePlugin, Plugin);

(function() {
  this.init = function() {
    var _self = this;
    this.workspace.getExt("state").on("statechange", function(state) {
      state.javaDebugClient    = !!_self.debugClient;
      state.javaProcessRunning = !!_self.child;
    });
  };

  this.command = function(user, message, client) {
    if (!(/java/.test(message.runner))) {
      return false;
    }

    var _self = this;

    var cmd = (message.command || "").toLowerCase();
    var res = true;
    switch (cmd) {
      case "run": 
      case "rundebug": 
      case "rundebugbrk": // We don't debug just yet.
        this.$run(message, client);
      break;
      case "kill":
        this.$kill();
      break;
      default:
        res = false;
      break;
    }
    return res;
  };

  this.$kill = function() {
    var child = this.child;
    if (!child) {
      return;
    }
    try {
      child.kill();
      // check after 2sec if the process is really dead
      // If not kill it harder
      setTimeout(function() {
        if (child.pid > 0) {
          child.kill("SIGKILL");
        }
      }, 2000)
    }
    catch(e) {}
  };

  this.$run = function(message, client) {
    var _self = this;

    if (this.child) {
      return _self.ide.error("Child process already running!", 1, message);
    }

    var file = _self.ide.workspaceDir + "/" + message.file;

    Path.exists(file, function(exists) {
      if (!exists) {
        return _self.ide.error("File does not exist: " + message.file, 2, message);
      }
      var cwd = _self.ide.workspaceDir + "/" + (message.cwd || "");

      Path.exists(cwd, function(exists) {
        if (!exists) {
          return _self.ide.error("cwd does not exist: " + message.cwd, 3, message);
        }
        // lets check what we need to run
        _self.$buildProc(file, cwd, message.env || {}, message.debug || false, function() {
          _self.$runProc(file, message.args, cwd, message.env || {}, message.debug || false);
        });
      });
    });
  };


  this.$buildProc = function(file, cwd, env, debug, callback) {
    var _self = this;

    // mixin process env
    for (var key in process.env) {
      if (!(key in env))
        env[key] = process.env[key];
      }

      var args = [].concat(file);
      if (debug) {
        args.push("-g");
      }

      console.log("Executing javac " + args.join(" "));

      var child = _self.child = Spawn("javac", args, {cwd: cwd, env: env});

      child.stdout.on("data", sender("stdout"));
      child.stderr.on("data", sender("stderr"));

      function sender(stream) {
        return function(data) {
        var message = {
          "type": "node-data",
          "stream": stream,
          "data": data.toString("utf8")
        };
        _self.ide.broadcast(JSON.stringify(message), _self.name);
      };
    }

    child.on("exit", function(code) {
      callback.call(_self);
    });

    return child;
  };

  this.$runProc = function(file, args, cwd, env, debug) {
    var _self = this;

    file = file.substring(0, file.lastIndexOf('.'));
    file = file.substring(file.lastIndexOf('/') + 1);
    file = file.substring(file.lastIndexOf('\\') + 1);
    var args = [].concat(file).concat(args || []);

    // mixin process env
    for (var key in process.env) {
      if (!(key in env)) {
        env[key] = process.env[key];
      }
    }

    console.log("Executing java " + args.join(" "));

    var child = _self.child = Spawn("java", args, {cwd: cwd, env: env});
    _self.debugClient = debug;
    _self.workspace.getExt("state").publishState();
    _self.ide.broadcast(JSON.stringify({"type": "node-start"}), _self.name);

    child.stdout.on("data", sender("stdout"));
    child.stderr.on("data", sender("stderr"));

    function sender(stream) {
      return function(data) {
        var message = {
          "type": "node-data",
          "stream": stream,
          "data": data.toString("utf8")
        };
        _self.ide.broadcast(JSON.stringify(message), _self.name);
      };
    }

    child.on("exit", function(code) {
      _self.ide.broadcast(JSON.stringify({"type": "node-exit"}), _self.name);

      _self.debugClient = false;
      delete _self.child;
    });

    return child;
  };

  this.dispose = function(callback) {
    this.$kill();
    callback();
  };
    
}).call(JavaRuntimePlugin.prototype);