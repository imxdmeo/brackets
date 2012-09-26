/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, JSLINT, PathUtils, document, window */

/**
 * Allows JSLint to run on the current document and report results in a UI panel.
 *
 */
define(function (require, exports, module) {
    "use strict";
    
    // Load dependent non-module scripts
    require("thirdparty/path-utils/path-utils.min");
    require("thirdparty/jslint/jslint");
    
    // Load dependent modules
    var Global                  = require("utils/Global"),
        Commands                = require("command/Commands"),
        CommandManager          = require("command/CommandManager"),
        DocumentManager         = require("document/DocumentManager"),
        EditorManager           = require("editor/EditorManager"),
        PreferencesManager      = require("preferences/PreferencesManager"),
        PerfUtils               = require("utils/PerfUtils"),
        Strings                 = require("strings"),
        AppInit                 = require("utils/AppInit");
    
    var MIN_HEIGHT = 100;
    
    var PREFERENCES_CLIENT_ID = module.id,
        defaultPrefs = { height: 200, enabled: true };
    
    // These vars are initialized by the htmlReady handler
    // below since they refer to DOM elements
    var $mainView,
        $jslintResults,
        $jslintContent,
        $jslintToolbar,
        $jslintResizer;
        
    /**
     * @private
     * @type {PreferenceStorage}
     */
    var _prefs = null;
    
    /**
     * @private
     * @type {boolean}
     */
    var _enabled = true;
    
    /**
     * @return {boolean} Enabled state of JSLint.
     */
    function getEnabled() {
        return _enabled;
    }
    
    /**
     * Run JSLint on the current document. Reports results to the main UI. Displays
     * a gold star when no errors are found.
     */
    function run() {
        var currentDoc = DocumentManager.getCurrentDocument();
        
        var perfTimerDOM,
            perfTimerLint;

        var ext = currentDoc ? PathUtils.filenameExtension(currentDoc.file.fullPath) : "";
        var $lintResults = $("#jslint-results");
        var $goldStar = $("#gold-star");
        
        if (getEnabled() && /^(\.js|\.htm|\.html)$/i.test(ext)) {
            perfTimerLint = PerfUtils.markStart("JSLint linting:\t" + (!currentDoc || currentDoc.file.fullPath));
            var text = currentDoc.getText();
            
            // If a line contains only whitespace, remove the whitespace
            // This should be doable with a regexp: text.replace(/\r[\x20|\t]+\r/g, "\r\r");,
            // but that doesn't work.
            var i, arr = text.split("\n");
            for (i = 0; i < arr.length; i++) {
                if (!arr[i].match(/\S/)) {
                    arr[i] = "";
                }
            }
            text = arr.join("\n");
            
            var result = JSLINT(text, null);

            PerfUtils.addMeasurement(perfTimerLint);
            perfTimerDOM = PerfUtils.markStart("JSLint DOM:\t" + (!currentDoc || currentDoc.file.fullPath));
            
            if (!result) {
                var $errorTable = $("<table class='zebra-striped condensed-table' />")
                                   .append("<tbody>");
                var $selectedRow;
                
                JSLINT.errors.forEach(function (item, i) {
                    if (item) {
                        var makeCell = function (content) {
                            return $("<td/>").text(content);
                        };
                        
                        // Add row to error table
                        var $row = $("<tr/>")
                            .append(makeCell(item.line))
                            .append(makeCell(item.reason))
                            .append(makeCell(item.evidence || ""))
                            .appendTo($errorTable);
                        
                        $row.click(function () {
                            if ($selectedRow) {
                                $selectedRow.removeClass("selected");
                            }
                            $row.addClass("selected");
                            $selectedRow = $row;
                            
                            var editor = EditorManager.getCurrentFullEditor();
                            editor.setCursorPos(item.line - 1, item.character - 1);
                            EditorManager.focusEditor();
                        });
                    }
                });

                $("#jslint-results .table-container")
                    .empty()
                    .append($errorTable);
                $lintResults.show();
                $goldStar.hide();
            } else {
                $lintResults.hide();
                $goldStar.show();
            }

            PerfUtils.addMeasurement(perfTimerDOM);

        } else {
            // JSLint is disabled or does not apply to the current file, hide
            // both the results and the gold star
            $lintResults.hide();
            $goldStar.hide();
        }
        
        EditorManager.resizeEditor();
    }
    
    /**
     * @private
     * Update DocumentManager listeners.
     */
    function _updateListeners() {
        if (_enabled) {
            // register our event listeners
            $(DocumentManager)
                .on("currentDocumentChange.jslint", function () {
                    run();
                })
                .on("documentSaved.jslint", function (event, document) {
                    if (document === DocumentManager.getCurrentDocument()) {
                        run();
                    }
                });
        } else {
            $(DocumentManager).off(".jslint");
        }
    }
    
    function _setEnabled(enabled) {
        _enabled = enabled;
        
        CommandManager.get(Commands.TOGGLE_JSLINT).setChecked(_enabled);
        _updateListeners();
        _prefs.setValue("enabled", _enabled);
    
        // run immediately
        run();
    }
    
    /**
     * Enable or disable JSLint.
     * @param {boolean} enabled Enabled state.
     */
    function setEnabled(enabled) {
        if (_enabled !== enabled) {
            _setEnabled(enabled);
        }
    }
    
    /** Command to toggle enablement */
    function _handleToggleJSLint() {
        setEnabled(!getEnabled());
    }
    
    /**
     * @private
     * Sets jslint panel height and resizes editor.
     * @param {number} height Height in pixels.
     */
    function _setHeight(height) {
        // There seems to be a race condition when accessing height if JSLint is
        // enabled when Brackets is opening. Neither htmlReady nor appReady seem 
        // to work for that. Forcing 27px height for the toolbar in that case.
        var toolbarHeight = $jslintToolbar.outerHeight(true);
        if (!$jslintToolbar.height()) {
            toolbarHeight = 27;
        }
        
        height = Math.max(height, MIN_HEIGHT);
        _prefs.setValue("height", height);
        
        $jslintResults.height(height);
        $jslintContent.height(height - toolbarHeight);
        
        EditorManager.resizeEditor();
    }
    
    /**
     * @private
     * Initialize resize handling.
     */
    function _initJSLintResizer() {
        var $body                   = $(document.body),
            animationRequest        = null,
            isMouseDown             = false;
                
        if (_enabled) {
            _setHeight(_prefs.getValue("height"));
        }
        
        $jslintResizer.on("mousedown.jslint", function (e) {
            var startY = e.clientY,
                startHeight = $jslintResults.height(),
                newHeight = startHeight + (startY - e.clientY),
                doResize = true;
            
            isMouseDown = true;
            $body.toggleClass("hor-resizing");
            
            animationRequest = window.webkitRequestAnimationFrame(function doRedraw() {
                // only run this if the mouse is down so we don't constantly loop even 
                // after we're done resizing.
                if (!isMouseDown) {
                    return;
                }
                
                if (doResize) {
                    _setHeight(newHeight);
                }
                
                animationRequest = window.webkitRequestAnimationFrame(doRedraw);
            });
            
            $mainView.on("mousemove.jslint", function (e) {
                // calculate newHeight as difference between stargint and current
                // position to avoid dependencies with other panels
                newHeight = startHeight + (startY - e.clientY);
                e.preventDefault();
            });
                
            $mainView.one("mouseup.jslint", function (e) {
                isMouseDown = false;
                $mainView.off("mousemove.jslint");
                $body.toggleClass("hor-resizing");
            });
            
            e.preventDefault();
        });
    }
    
    // Register command handlers
    CommandManager.register(Strings.CMD_JSLINT, Commands.TOGGLE_JSLINT, _handleToggleJSLint);
    
    // Init PreferenceStorage
    _prefs = PreferencesManager.getPreferenceStorage(PREFERENCES_CLIENT_ID, defaultPrefs);
    _setEnabled(_prefs.getValue("enabled"));
    
    // Initialize items dependent on HTML DOM
    AppInit.htmlReady(function () {
        $mainView       = $(".main-view");
        $jslintResults  = $("#jslint-results");
        $jslintResizer  = $("#jslint-resizer");
        $jslintToolbar  = $("#jslint-results .toolbar");
        $jslintContent  = $("#jslint-results .table-container");

        // init
        _initJSLintResizer();
    });
    
    // Define public API
    exports.run = run;
    exports.getEnabled = getEnabled;
    exports.setEnabled = setEnabled;
});
