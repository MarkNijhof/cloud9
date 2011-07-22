/**
 * Console for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
 
define(function(require, exports, module) {

var ide = require("core/ide");
var ext = require("core/ext");
var lang = require("pilot/lang");
var panels = require("ext/panels/panels");
var editors = require("ext/editors/editors");
var Parser = require("ext/console/parser");
var Trie = require("ext/console/trie");
var css = require("text!ext/console/console.css");
var markup = require("text!ext/console/console.xml");

var trieCommands, hintNodes, hintsTimer,
    selectedHint = null,
    commands     = {},
    cmdTries     = {},
    cmdFetched   = false,
    cmdHistory   = [],
    cmdBuffer    = "",
    lastSearch   = null,
    parser       = new Parser();

return ext.register("ext/console/console", {
    name   : "Console",
    dev    : "Ajax.org",
    type   : ext.GENERAL,
    alone  : true,
    markup : markup,
    css    : css,
    
    commandHistoryIndex : 0,
    excludeParent : true,
    commands : {
        "help": {hint: "show general help information and a list of available commands"},
        "clear": {hint: "clear all the messages from the console"},
        "switchconsole" : {hint: "toggle focus between the editor and the console"},
        "send": {hint: "send a message to the server"}
    },

    help : function() {
        var words = trieCommands.getWords(),
            text  = [];

        for (var i = 0, l = words.length; i < l; ++i) {
            if (!commands[words[i]]) continue;
            text.push(words[i] + "\t\t\t\t" + commands[words[i]].hint);
        }
        this.logNodeStream(text.join("\n"));
    },
    
    clear : function() {
        this.inited && txtOutput.clear();
    },
    
    switchconsole : function() {
        if (apf.activeElement == txtConsoleInput) {
            if (window.ceEditor) {
                ceEditor.focus();
                this.disable();
            }
        }
        else
            txtConsoleInput.focus()
    },

    send : function(data) {
        ide.socket.send(data.line.replace(data.command,"").trim());
        return true;
    },

    
    showOutput : function(){
        tabConsole.set(1);
    },

    jump: function(path, row, column) {
        row = parseInt(row.slice(1));
        column = column ? parseInt(column.slice(1)) : 0;
        editors.showFile(path, row, column);
    },

    getCwd: function() {
        return this.$cwd && this.$cwd.replace("/workspace", ide.workspaceDir);
    },

    logNodeStream : function(data, stream, useOutput) {
        var colors = {
            30: "#eee",
            31: "red",
            32: "green",
            33: "yellow",
            34: "blue",
            35: "magenta",
            36: "cyan",
            37: "#eee"
        };

        workspaceDir = ide.workspaceDir;
        davPrefix = ide.davPrefix;

        var lines = data.split("\n");
        var style = "color:#eee;";
        var log = [];
        // absolute workspace files
        var wsRe = new RegExp(lang.escapeRegExp(workspaceDir) + "\\/([^:]*)(:\\d+)(:\\d+)*", "g");
        // relative workspace files
        var wsrRe = /(?:\s|^|\.\/)([\w\_\$-]+(?:\/[\w\_\$-]+)+(?:\.[\w\_\$]+))?(\:\d+)(\:\d+)*/g;

        for (var i=0; i<lines.length; i++) {
            if (!lines[i]) continue;
            log.push("<div class='item'><span style='" + style + "'>" + lines[i]
                .replace(wsRe, "<a href='javascript:void(0)' onclick='require(\"ext/console/console\").jump(\"" + davPrefix + "/$1\", \"$2\", \"$3\")'>"+workspaceDir+"/$1$2$3</a>")
                .replace(wsrRe, "<a href='javascript:void(0)' onclick='require(\"ext/console/console\").jump(\"" + davPrefix + "/$1\", \"$2\", \"$3\")'>$1$2$3</a>")
                .replace(/\s{2,}/g, function(str) {
                    return lang.stringRepeat("&nbsp;", str.length)
                })
                .replace(/(((http:\/\/)|(www\.))[\w\d\.-]*(:\d+)?(\/[\w\d]+)?)/, "<a href='$1' target='_blank'>$1</a>")
                // tty escape sequences (http://ascii-table.com/ansi-escape-sequences.php)
                .replace(/(\u0007|\u001b)\[(K|2J)/g, "")
                .replace(/\033\[(?:(\d+);)?(\d+)m/g, function(m, extra, color) {
                    style = "color:" + (colors[color] || "#eee");
                    if (extra == 1) {
                        style += ";font-weight=bold"
                    } else if (extra == 4) {
                        style += ";text-decoration=underline";
                    }
                    return "</span><span style='" + style + "'>"
                }) + "</span></div>");
        }

        (useOutput ? txtOutput : txtConsole).addValue(log.join(""));
    },

    log : function(msg, type, pre, post, otherOutput){
        msg = apf.htmlentities(String(msg));

        if (!type)
            type = "log";
        else if (type == "divider") {
            msg = "<span style='display:block;border-top:1px solid #444; margin:6px 0 6px 0;'></span>";
        }
        else if (type == "prompt") {
            msg = "<span style='color:#86c2f6'>" + msg + "</span>";
        }
        else if (type == "command") {
            msg = "<span style='color:#86c2f6'><span style='float:left'>&gt;&gt;&gt;</span><div style='margin:0 0 0 25px'>"
                + msg + "</div></span>";
        }
        (otherOutput || txtConsole).addValue("<div class='item console_" + type + "'>" + (pre || "") + msg + (post || "") + "</div>");
    },

    write: function(aLines) {
        if (typeof aLines == "string")
            aLines = aLines.split("\n");
        for (var i = 0, l = aLines.length; i < l; ++i)
            this.log(aLines[i], "log");
        this.log("", "divider");
    },

    evaluate : function(expression, callback){
        var _self = this;
        var frame = dgStack && dgStack.selected && dgStack.selected.getAttribute("ref") || null;
        dbg.evaluate(expression, frame, null, null, callback || function(xmlNode){
            _self.showObject(xmlNode);
        });
    },

    checkChange : function(xmlNode){
        var value = xmlNode.getAttribute("value");
        if (xmlNode.tagName == "method" || "Boolean|String|undefined|null|Number".indexOf(xmlNode.getAttribute("type")) == -1)
            return false;
    },

    applyChange : function(xmlNode){
        var value = xmlNode.getAttribute("value");
        var name = this.calcName(xmlNode);
        try{
            if (name.indexOf(".") > -1) {
                var prop, obj = self.parent.eval(name.replace(/\.([^\.\s]+)$/, ""));
                if (obj && obj.$supportedProperties && obj.$supportedProperties.contains(prop = RegExp.$1)) {
                    obj.setProperty(prop, self.parent.eval(value));
                    return;
                }
            }

            self.parent.eval(name + " = " + value);

            //@todo determine new type
        }
        catch(e) {
            trObject.getActionTracker().undo();
            alert("Invalid Action: " + e.message);
            //@todo undo
        }
    },

    calcName : function(xmlNode, useDisplay){
        var isMethod = xmlNode.tagName == "method";
        var name, loopNode = xmlNode, path = [];
        do {
            name = useDisplay
                ? loopNode.getAttribute("display") || loopNode.getAttribute("name")
                : loopNode.getAttribute("name");

            if (!name)
                break;

            path.unshift(!name.match(/^[a-z_\$][\w_\$]*$/i)
                ? (parseInt(name) == name
                    ? "[" + name + "]"
                    : "[\"" + name.replace(/'/g, "\\'") + "\"]")
                : name);
            loopNode = loopNode.parentNode;
            if (isMethod) {
                loopNode = loopNode.parentNode;
                isMethod = false;
            }
        }
        while (loopNode && loopNode.nodeType == 1);

        if (path[0].charAt(0) == "[")
            path[0] = path[0].substr(2, path[0].length - 4);
        return path.join(".").replace(/\.\[/g, "[");
    },

    keyupHandler: function(e) {
        var code = e.keyCode;
        if (code != 9 && code != 13 && code != 38 && code != 40 && code != 27) {
            return this.commandTextHandler(e);
        }
    },

    keydownHandler: function(e) {
        var code = e.keyCode;
        if (code == 9 || code == 13 || code == 38 || code == 40 || code == 27) {
            return this.commandTextHandler(e);
        }
    },

    commandTextHandler: function(e) {
        var line      = e.currentTarget.getValue(),
            //idx       = cmdHistory.indexOf(line),
            hisLength = cmdHistory.length,
            newVal    = "",
            code      = e.keyCode;
        if (cmdBuffer === null || (this.commandHistoryIndex == 0 && cmdBuffer !== line))
            cmdBuffer = line;
        parser.parseLine(line);

        if (code == 38) { //UP
            if (this.$winHints.visible) {
                this.selectHintUp();
            }
            else {
                if (!hisLength)
                    return;
                newVal = cmdHistory[--this.commandHistoryIndex];
                if (this.commandHistoryIndex < 0)
                    this.commandHistoryIndex = 0;
                if (newVal)
                    e.currentTarget.setValue(newVal);
            }
            return false;
        }
        else if (code == 40) { //DOWN
            if (this.$winHints.visible) {
                this.selectHintDown();
            }
            else {
                if (!hisLength)
                    return;
                newVal = cmdHistory[++this.commandHistoryIndex] || "";//(++idx > hisLength - 1 || idx === 0) ? (cmdBuffer || "") : 
                if (this.commandHistoryIndex >= cmdHistory.length)
                    this.commandHistoryIndex = cmdHistory.length;
                e.currentTarget.setValue(newVal);
            }
            return false;
        }
        else if (code == 27 && this.$winHints.visible) {
            return this.hideHints();
        }
        else if (code != 13 && code != 9) {
            this.autoComplete(e, parser, 2);
            return;
        }
        
        if (this.$winHints.visible && selectedHint && hintNodes)
            return this.hintClick(hintNodes[selectedHint]);

        if (parser.argv.length === 0) {
            // no commmand line input

            if (e.name == "keydown") {
                //this.log(this.getPrompt(), "prompt");
                //this.enable();
            }
        }
        else if (parser.argQL[0]) {
            // first argument quoted -> error
            this.write("Syntax error: first argument quoted.");
        }
        else {
            var s,
                cmd = parser.argv[parser.argc++];

            if (code == 9) {
                this.autoComplete(e, parser, 1);
                return false;
            }

            this.commandHistoryIndex = cmdHistory.push(line);
            cmdBuffer = null;
            e.currentTarget.setValue(newVal);
            this.hideHints();

            this.log(this.getPrompt() + " " + parser.argv.join(" "), "prompt");
            this.enable();
            tabConsole.set("console");

            switch (cmd) {
                case "help":
                    this.help();
                    break;
                case "clear":
                    txtConsole.clear();
                    break;
                case "sudo":
                    s = parser.argv.join(" ").trim();
                    if (s == "sudo make me a sandwich") {
                        this.write("Okay.");
                        break;
                    }
                    else if (s == "sudo apt-get moo") {
                        //this.clear();
                        this.write([" ",
                            "        (__)",
                            "        (oo)",
                            "  /------\\/ ",
                            " / |    ||  ",
                            "*  /\\---/\\  ",
                            "   ~~   ~~  ",
                            "....\"Have you mooed today?\"...",
                            " "]);
                        break;
                    }
                    else {
                        this.write("E: Invalid operation " + parser.argv[parser.argc++]);
                        break;
                    }
                case "man":
                    var pages = {
                        "last": "Man, last night was AWESOME.",
                        "help": "Man, help me out here.",
                        "next": "Request confirmed; you will be reincarnated as a man next.",
                        "cat":  "You are now riding a half-man half-cat."
                    };
                    this.write((pages[parser.argv[parser.argc++]]
                        || "Oh, I'm sure you can figure it out."));
                    break;
                case "locate":
                    var keywords = {
                        "ninja": "Ninja can not be found!",
                        "keys": "Have you checked your coat pocket?",
                        "joke": "Joke found on user.",
                        "problem": "Problem exists between keyboard and chair.",
                        "raptor": "BEHIND YOU!!!"
                    };
                    this.write((keywords[parser.argv[parser.argc++]] || "Locate what?"));
                    break;
                default:
                    var jokes = {
                        "make me a sandwich": "What? Make it yourself.",
                        "make love": "I put on my robe and wizard hat.",
                        "i read the source code": "<3",
                        //"pwd": "You are in a maze of twisty passages, all alike.",
                        "lpr": "PC LOAD LETTER",
                        "hello joshua": "How about a nice game of Global Thermonuclear War?",
                        "xyzzy": "Nothing happens.",
                        "date": "March 32nd",
                        "hello": "Why hello there!",
                        "who": "Doctor Who?",
                        "su": "God mode activated. Remember, with great power comes great ... aw, screw it, go have fun.",
                        "fuck": "I have a headache.",
                        "whoami": "You are Richard Stallman.",
                        "nano": "Seriously? Why don't you just use Notepad.exe? Or MS Paint?",
                        "top": "It's up there --^",
                        "moo":"moo",
                        "ping": "There is another submarine three miles ahead, bearing 225, forty fathoms down.",
                        "find": "What do you want to find? Kitten would be nice.",
                        "more":"Oh, yes! More! More!",
                        "your gay": "Keep your hands off it!",
                        "hi":"Hi.",
                        "echo": "Echo ... echo ... echo ...",
                        "bash": "You bash your head against the wall. It's not very effective.",
                        "ssh": "ssh, this is a library.",
                        "uname": "Illudium Q-36 Explosive Space Modulator",
                        "finger": "Mmmmmm...",
                        "kill": "Terminator deployed to 1984.",
                        "use the force luke": "I believe you mean source.",
                        "use the source luke": "I'm not luke, you're luke!",
                        "serenity": "You can't take the sky from me.",
                        "enable time travel": "TARDIS error: Time Lord missing.",
                        "ed": "You are not a diety."
                    };
                    s = parser.argv.join(" ").trim();
                    if (jokes[s]) {
                        this.write(jokes[s]);
                        break;
                    }
                    else {
                        var data = {
                            command: cmd,
                            argv: parser.argv,
                            line: line,
                            cwd: this.getCwd()
                        };
                        ide.dispatchEvent("track_action", {type: "console", cmd: cmd});
                        if (ext.execCommand(cmd, data) !== false) {
                            if (ide.dispatchEvent("consolecommand." + cmd, {
                              data: data
                            }) !== false) {
                                if (!ide.onLine)
                                    this.write("Cannot execute command. You are currently offline.");
                                else
                                    ide.socket.send(JSON.stringify(data));
                            }
                        }
                        return;
                    }
            }
        }
    },

    onMessage: function(e) {
        var res,
            message = e.message;
            
        if (message.type == "node-data")
            return this.logNodeStream(message.data, message.stream, true);
        
        if (message.type != "result")
            return;

        switch (message.subtype) {
            case "commandhints":
                var cmds = message.body;
                for (var cmd in cmds) {
                    trieCommands.add(cmd);
                    commands[cmd] = cmds[cmd];
                    if (cmds[cmd].commands)
                        this.subCommands(cmds[cmd].commands, cmd);
                }
                cmdFetched = true;
                break;
            case "internal-autocomplete":
                res = message.body;
                var base = res.base || "",
                    blen = base.length;
                lastSearch = res;
                lastSearch.trie = new Trie();
                for (var m, i = 0, l = res.matches.length; i < l; ++i) {
                    m = res.matches[i];
                    lastSearch.trie.add(m);
                    if (base && m.indexOf(base) === 0)
                        res.matches[i] = m.substr(blen - 1);
                }
                this.showHints(res.textbox, res.base || "", res.matches, null, res.cursor);
                break;
            case "cd":
                res = message.body;
                if (res.cwd) {
                    this.$cwd = res.cwd.replace(ide.workspaceDir, "/workspace");
                    this.write("Working directory changed.");
                }
                break;
            case "git":
            case "npm":
            case "pwd":
            case "hg":
            case "ls":
            case "java":
                res = message.body;
                //this.getPrompt() + " " + res.argv.join(" ") + "\n" + 
                if (res.out)
                    this.logNodeStream(res.out);
                if (res.err)
                    this.logNodeStream(res.err);
                if (res.code) // End of command
                    this.log("", "divider");
                break;
            case "mkdir":
                res = message.body;
                ide.dispatchEvent("treecreate", {
                    type : "folder",
                    path : this.$cwd + "/" + res.argv[res.argv.length - 1] 
                });
                break;
            case "error":
                //console.log("error: ", message.body);
                this.log(message.body);
                this.log("", "divider");
                break;
        }

        ide.dispatchEvent("consoleresult." + message.subtype, {data: message.body});
    },

    setPrompt: function(cwd) {
        if (cwd)
            this.$cwd = cwd.replace(ide.workspaceDir, ide.davPrefix);
        return this.getPrompt();
    },

    getPrompt: function() {
        return "[guest@cloud9]:" + this.$cwd + "$";
    },

    subCommands: function(cmds, prefix) {
        if (!cmdTries[prefix]) {
            cmdTries[prefix] = {
                trie    : new Trie(),
                commands: cmds
            };
        }
        for (var cmd in cmds) {
            cmdTries[prefix].trie.add(cmd);
            if (cmds[cmd].commands)
                this.subCommands(cmds[cmd].commands, prefix + "-" + cmd);
        }
    },

    autoComplete: function(e, parser, mode) {
        mode = mode || 2;
        if (mode === 1) {
            if (this.$busy) return;
            var _self = this;
            this.$busy = setTimeout(function(){clearTimeout(_self.$busy);_self.$busy = null;}, 100);
        }
        if (!trieCommands) {
            trieCommands = new Trie();
            apf.extend(commands, ext.commandsLut);
            for (var name in ext.commandsLut) {
                trieCommands.add(name);
                if (ext.commandsLut[name].commands)
                    this.subCommands(ext.commandsLut[name].commands, name);
            }
        }

        // keycodes that invalidate the previous autocomplete:
        if (e.keyCode == 8 || e.keyCode == 46)
            lastSearch = null;

        var root,
            list      = [],
            cmds      = commands,
            textbox   = e.currentTarget,
            val       = textbox.getValue(),
            len       = parser.argv.length,
            base      = parser.argv[0],
            cursorPos = 0;
        if (!apf.hasMsRangeObject) {
            var input = textbox.$ext.getElementsByTagName("input")[0];
            cursorPos = input.selectionStart;
        }
        else {
            var range = document.selection.createRange(),
                r2    = range.duplicate();
            r2.expand("textedit");
            r2.setEndPoint("EndToStart", range);
            cursorPos = r2.text.length;
        }
        --cursorPos;

        if (!cmdFetched) {
            ide.socket.send(JSON.stringify({
                command: "commandhints",
                argv: parser.argv,
                cwd: this.getCwd()
            }));
        }

        if (typeof parser.argv[0] != "string")
            return this.hideHints();

        // check for commands in first argument when there is only one argument
        // provided, or when the cursor on the first argument
        if (len == 1 && cursorPos < parser.argv[0].length) {
            root = trieCommands.find(parser.argv[0]);
            if (root)
                list = root.getWords();
        }
        else {
            var idx, needle, cmdTrie,
                i = len - 1;
            for (; i >= 0; --i) {
                idx = val.indexOf(parser.argv[i]);
                if (idx === -1) //shouldn't happen, but yeah...
                    continue;
                if (cursorPos >= idx || cursorPos <= idx + parser.argv[i].length) {
                    needle = i;
                    break;
                }
            }
            if (typeof needle != "number")
                needle = 0;

            ++needle;
            while (needle >= 0 && !(cmdTrie = cmdTries[parser.argv.slice(0, needle).join("-")]))
                --needle

            if (cmdTrie) {
                //console.log("needle we're left with: ", needle, len, parser.argv[needle]);
                base = parser.argv[needle];
                root = cmdTrie.trie.find(base);
                if (root) {
                    list = root.getWords();
                }
                else {
                    list = cmdTrie.trie.getWords();
                    // check for file/folder autocompletion:
                    if (list.length == 1 && list[0] == "[PATH]") {
                        //console.log("we have PATH, ", base, lastSearch);
                        if (base && lastSearch) {
                            list.splice(0, 1);
                            var newbase = base.split("/").pop();
                            if (!newbase) {
                                base = "";
                                list = lastSearch.trie.getWords();
                            }
                            else if (newbase.indexOf(lastSearch.base) > -1) {
                                // console.log("searching for ", newbase, base, "mode:", mode);
                                root = lastSearch.trie.find(newbase);
                                if (root) {
                                    // console.log("setting base ", base, "to", base, newbase);
                                    base = newbase;
                                    list = root.getWords();
                                }
                            }
                            if (!list.length) {
                                // we COULD do something special here...
                            }
                        }
                        else {
                            if (mode == 2)
                                list.splice(0, 1);
                            //base = "";
                        }
                        // adjust the argv array to match the current cursor position:
                        parser.argv = parser.argv.slice(0, needle);
                        parser.argv.push(base);
                        // else: autocompletion is sent to the backend
                        //console.log("directory found: ", base, list, "mode:", mode);
                    }
                    else {
                        base = "";
                    }
                }
                cmds = cmdTrie.commands;
                //console.log("list: ", list, base, parser.argv);
            }
        }

        if (list.length === 0)
            return this.hideHints();

        if (mode === 2) { // hints box
            this.showHints(textbox, base || "", list, cmds, cursorPos);
        }
        else if (mode === 1) { // TAB autocompletion
            var ins = base ? list[0].substr(1) : list[0];
            if (ins.indexOf("PATH]") != -1 && lastSearch && lastSearch.line == val && lastSearch.matches.length == 1)
                ins = lastSearch.matches[0].replace(lastSearch.base, "");
            if (ins.indexOf("PATH]") != -1) {
                ide.socket.send(JSON.stringify({
                    command: "internal-autocomplete",
                    line   : val,
                    textbox: textbox.id,
                    cursor : cursorPos,
                    argv   : parser.argv,
                    cwd    : this.getCwd()
                }));
            }
            else {
                if (!!(cmds || commands)[base + ins])
                    ins += " "; // for commands we suffix with whitespace
                var newval = val.substr(0, cursorPos + 1) + ins + val.substr(cursorPos + 1);
                if (val != newval)
                    textbox.setValue(newval);
                lastSearch = null;
            }
            this.hideHints();
        }
    },
    
    initHints: function() {
        if (this.$winHints) return;
        this.$winHints = document.getElementById("barConsoleHints");
        apf.addListener(this.$winHints, "mousemove", this.hintsMouseHandler.bind(this));
    },

    showHints: function(textbox, base, hints, cmdsLut, cursorPos) {
        var name = "console_hints";
        if (typeof textbox == "string")
            textbox = self[textbox];
        //console.log("showing hints for ", base, hints && hints[0]);
        //base = base.substr(0, base.length - 1);

        if (this.control && this.control.stop)
            this.control.stop();

        var cmdName, cmd, isCmd,
            content = [],
            i       = 0,
            len     = hints.length;

        for (; i < len; ++i) {
            cmdName = base ? base + hints[i].substr(1) : hints[i];
            //console.log("isn't this OK? ", cmdName, base);
            cmd = (cmdsLut || commands)[cmdName];
            isCmd = !!cmd;
            content.push('<a href="javascript:void(0);" onclick="require(\'ext/console/console\').hintClick(this);" ' 
                + 'data-hint="'+ base + ',' + cmdName + ',' + textbox.id + ',' + cursorPos + ',' + isCmd + '">'
                + cmdName + ( cmd
                ? '<span>' + cmd.hint + (cmd.hotkey
                    ? '<span class="hints_hotkey">' + (apf.isMac
                        ? apf.hotkeys.toMacNotation(cmd.hotkey)
                        : cmd.hotkey) + '</span>'
                    : '') + '</span>'
                : '')
                + '</a>');
        }

        this.initHints();
        hintNodes = null;
        selectedHint = null;

        this.$winHints.innerHTML = content.join("");

        if (apf.getStyle(this.$winHints, "display") == "none") {
            //this.$winHints.style.top = "-30px";
            this.$winHints.style.display = "block";
            this.$winHints.visible = true;
            //txtConsoleInput.focus();

            //Animate
            /*apf.tween.single(this.$winHints, {
                type     : "fade",
                anim     : apf.tween.easeInOutCubic,
                from     : 0,
                to       : 100,
                steps    : 8,
                interval : 10,
                control  : (this.control = {})
            });*/
        }

        var pos = apf.getAbsolutePosition(textbox.$ext, this.$winHints.parentNode);
        this.$winHints.style.left = Math.max(cursorPos * 5.5, 5) + "px";
        //this.$winHints.style.top = (pos[1] - this.$winHints.offsetHeight) + "px";
    },

    hideHints: function() {
        this.initHints();
        this.$winHints.style.display = "none";
        this.$winHints.visible = false;
        selectedHint = null;
        //@todo: animation
    },

    hintClick: function(node) {
        var parts       = node.getAttribute("data-hint").split(","),
            base        = parts[0],
            cmdName     = parts[1],
            txtId       = parts[2],
            insertPoint = parseInt(parts[3]),
            isCmd       = (parts[4] == "true");

        if (isCmd)
            cmdName += " "; // for commands we suffix with whitespace
        var textbox = self[txtId],
            input   = textbox.$ext.getElementsByTagName("input")[0],
            val     = textbox.getValue(),
            before  = val.substr(0, (insertPoint + 1 - base.length)) + cmdName;
        textbox.setValue(before + val.substr(insertPoint + 1));
        textbox.focus();
        // set cursor position at the end of the text just inserted:
        var pos = before.length;
        if (apf.hasMsRangeObject) {
            var range = input.createTextRange();
            range.expand("textedit");
            range.select();
            range.collapse();
            range.moveStart("character", pos);
            range.moveEnd("character", 0);
            range.collapse();
        }
        else {
            input.selectionStart = input.selectionEnd = pos;
        }

        this.hideHints();
    },
    
    hintsMouseHandler: function(e) {
        clearTimeout(hintsTimer);
        var el = e.target || e.srcElement;
        while (el && el.nodeType == 3 && el.tagName != "A" && el != this.$winHints)
            el = el.parentNode;
        if (el.tagName != "A") return;
        var _self = this;
        hintsTimer = setTimeout(function() {
            _self.selectHint(el);
        }, 5);
    },

    selectHintUp: function() {
        if (!hintNodes)
            hintNodes = this.$winHints.getElementsByTagName("a");
        return this.selectHint(selectedHint - 1 < 0 ? hintNodes.length - 1 : --selectedHint);
    },

    selectHintDown: function() {
        if (!hintNodes)
            hintNodes = this.$winHints.getElementsByTagName("a");
        return this.selectHint(selectedHint + 1 > hintNodes.length - 1 ? 0 : ++selectedHint);
    },
    
    selectHint: function(hint) {
        clearTimeout(hintsTimer);
        if (!hintNodes)
            hintNodes = this.$winHints.getElementsByTagName("a");

        if (typeof hint == "number")
            hint = hintNodes[hint];

        for (var i = 0, l = hintNodes.length; i < l; ++i) {
            if (hintNodes[i] === hint) {
                selectedHint = i;
                continue;
            }
            hintNodes[i].className = "";
        }
        if (hint)
            hint.className = "selected";
    },

    consoleTextHandler: function(e) {
        if(e.keyCode == 13 && e.ctrlKey) {
            var _self = this;
            
            var expression = txtCode.getValue().trim();
            if (!expression)
                return;
            
            tabConsole.set(1);
            this.log(expression, "command", null, null, txtOutput);
            
            this.evaluate(expression, function(xmlNode, body, refs, error){
                if (error)
                    _self.log(error.message, "error");
                else {
                    var type = body.type, value = body.value || body.text, ref = body.handle, className = body.className;
                    if (className == "Function") {
                        var pre = "<a class='xmlhl' href='javascript:void(0)' style='font-weight:bold;font-size:7pt;color:green' onclick='require(\"ext/console/console\").showObject(null, ["
                            + body.scriptId + ", " + body.line + ", " + body.position + ", "
                            + body.handle + ",\"" + (body.name || body.inferredName) + "\"], \""
                            + (expression || "").split(";").pop().replace(/"/g, "\\&quot;") + "\")'>";
                        var post = "</a>";
                        var name = body.name || body.inferredName || "function";
                        _self.log(name + "()", "log", pre, post, txtOutput);
                    }
                    else if (className == "Array") {
                        var pre = "<a class='xmlhl' href='javascript:void(0)' style='font-weight:bold;font-size:7pt;color:green' onclick='require(\"ext/console/console\").showObject(\""
                            + apf.escapeXML(xmlNode.xml.replace(/"/g, "\\\"")) + "\", "
                            + ref + ", \"" + apf.escapeXML((expression || "").trim().split(/;|\n/).pop().trim().replace(/"/g, "\\\"")) + "\")'>";
                        var post = " }</a>";

                        _self.log("Array { length: "
                            + (body.properties && body.properties.length - 1), "log", pre, post, txtOutput);
                    }
                    else if (type == "object") {
                        var refs = [], props = body.properties;
                        for (var i = 0, l = body.properties.length; i < l; i++) {
                            refs.push(props[i].ref);
                        }

                        var pre = "<a class='xmlhl' href='javascript:void(0)' style='font-weight:bold;font-size:7pt;color:green' onclick='require(\"ext/console/console\").showObject(\""
                            + apf.escapeXML(xmlNode.xml.replace(/"/g, "\\\"")) + "\", "
                            + ref + ", \"" + apf.escapeXML((expression || "").trim().split(/;|\n/).pop().trim().replace(/"/g, "\\\"")) + "\")'>";
                        var post = " }</a>";

                        dbg.$debugger.$debugger.lookup(refs, false, function(body) {
                            var out = [className || value, "{"];
                            for (var item, t = 0, i = 0; i < l; i++) {
                                item = body[refs[i]];
                                if (item.className == "Function" || item.className == "Object")
                                    continue;
                                if (t == 5) {
                                    out.push("more...");
                                    break;
                                }
                                var name = props[i].name || (props[i].inferredName || "Unknown").split(".").pop();
                                out.push(name + "=" + item.value, ", ");
                                t++;
                            }
                            if (t) out.pop();

                            _self.log(out.join(" "), "log", pre, post, txtOutput);
                        });
                    }
                    else
                        _self.log(value, "log", null, null, txtOutput);
                }
            });

            require("ext/settings/settings").save();
            return false;
        }
    },

    showObject : function(xmlNode, ref, expression) {
        if (ref && ref.dataType == apf.ARRAY) {
            require(["ext/debugger/debugger"], function(dbg) {
                dbg.showDebugFile(ref[0], ref[1] + 1, 0, ref[4]);
            });
        }
        else {
            require(["ext/quickwatch/quickwatch"], function(quickwatch) {
                quickwatch.toggleDialog(1);
                
                if (xmlNode && typeof xmlNode == "string")
                    xmlNode = apf.getXml(xmlNode);

                var name = xmlNode && xmlNode.getAttribute("name") || expression;
                txtCurObject.setValue(name);
                dgWatch.clear("loading");

                if (xmlNode) {
                    setTimeout(function(){
                        var model = dgWatch.getModel();
                        var root  = apf.getXml("<data />");
                        apf.xmldb.appendChild(root, xmlNode);
                        model.load(root);
                        //model.appendXml(xmlNode);
                    }, 10);
                }
                else if (ref) {

                }
                else {
                    this.evaluate(expression);
                }
            });

        }
    },

    types : ["Object", "Number", "Boolean", "String", "Array", "Date", "RegExp", "Function", "Object"],
    domtypes : [null, "Element", "Attr", "Text", "CDataSection",
                "EntityReference", "Entity", "ProcessingInstruction", "Comment",
                "Document", "DocumentType", "DocumentFragment", "Notation"],

    calcName : function(xmlNode, useDisplay){
        var isMethod = xmlNode.tagName == "method";
        var name, loopNode = xmlNode, path = [];
        do {
            name = useDisplay
                ? loopNode.getAttribute("display") || loopNode.getAttribute("name")
                : loopNode.getAttribute("name");

            if (!name)
                break;

            path.unshift(!name.match(/^[a-z_\$][\w_\$]*$/i)
                ? (parseInt(name) == name
                    ? "[" + name + "]"
                    : "[\"" + name.replace(/'/g, "\\'") + "\"]")
                : name);
            loopNode = loopNode.parentNode;
            if (isMethod) {
                loopNode = loopNode.parentNode;
                isMethod = false;
            }
        }
        while (loopNode && loopNode.nodeType == 1);

        if (path[0].charAt(0) == "[")
            path[0] = path[0].substr(2, path[0].length - 4);
        return path.join(".").replace(/\.\[/g, "[");
    },

    /**** Init ****/

    hook : function(){
        panels.register(this);
        panels.initPanel(this);
    },

    init : function(amlNode){
        var _self = this
        this.panel = tabConsole;
        this.$cwd  = "/workspace";

        //Append the console window at the bottom below the tab
        mainRow.appendChild(winDbgConsole); //selectSingleNode("a:hbox[1]/a:vbox[2]").

        apf.importCssString((this.css || "") + " .console_date{display:inline}");
        
        stProcessRunning.addEventListener("activate", function() {
            _self.clear();
            _self.showOutput();
            _self.enable();
        });
        
        ide.addEventListener("socketMessage", this.onMessage.bind(this));
        ide.addEventListener("consoleresult.internal-isfile", function(e) {
            var data = e.data;
            var path = data.cwd.replace(ide.workspaceDir, ide.davPrefix);
            if (data.isfile)
                editors.showFile(path);
            else
                _self.log("'" + path + "' is not a file.");
        });
        
        winDbgConsole.previousSibling.hide();
    },

    enable : function(fromParent){
        /*if (!this.panel)
            panels.initPanel(this);

        if (this.manual && fromParent)
            return;

        if (!fromParent)
            this.manual = true;*/

        this.mnuItem.check();
        tabConsole.show();

        if (winDbgConsole.height == 41)
            winDbgConsole.setAttribute("height", this.height || 200);
        winDbgConsole.previousSibling.show();
        
        apf.layout.forceResize();
        apf.setStyleClass(btnCollapseConsole.$ext, "btn_console_openOpen");

    },

    disable : function(fromParent){
        /*if (this.manual && fromParent || !this.inited)
            return;

        if (!fromParent)
            this.manual = true;*/

        this.mnuItem.uncheck();
        tabConsole.hide();

        if (winDbgConsole.height != 41)
            this.height = winDbgConsole.height;
        winDbgConsole.setAttribute("height", 41);
        winDbgConsole.previousSibling.hide();
        
        apf.layout.forceResize();
        apf.setStyleClass(btnCollapseConsole.$ext, '' , ['btn_console_openOpen']);
    },

    destroy : function(){
        winDbgConsole.destroy(true, true);
        panels.unregister(this);
    }
});

});
