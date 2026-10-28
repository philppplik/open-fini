# Keyboard Shortcuts

This page lists the default keyboard shortcuts of OpenFini. It is generated from the command registry (`app/src/commands/*`) and the tool classes (`app/src/studios/tools/*`) by `npm run wiki:shortcuts`, so it matches the code at the time of the last wiki update. `Mod` means `Ctrl` on Windows and Linux and `Cmd` on macOS. Every shortcut can be rebound in *Settings ▸ Keyboard shortcuts* (see [[Customization and Profiles]]).

> In a normal browser tab a few combinations (for example `Ctrl+N`, `Ctrl+W`, `Ctrl+T`) are reserved by the browser. Install the PWA or use the desktop app for the full set; every action is also in the menus and the command palette (`Ctrl+K`).

## Tool shortcuts

A tool key is a single letter pressed while the canvas has focus. Several tools can share a key; the Studio column shows where each one is available.

| Key | Tool | Studio |
| --- | --- | --- |
| `\\` | Line | vector, layout, pixel |
| `A` | Node | vector, layout |
| `B` | Paint Brush | pixel |
| `B` | Pixel Pencil | pixel |
| `B` | Table | layout |
| `C` | Crop | pixel, vector, layout |
| `D` | Burn | pixel |
| `D` | Dodge | pixel |
| `D` | Sponge | pixel |
| `E` | Ellipse | vector, layout, pixel |
| `E` | Eraser | pixel |
| `F` | Fill | vector, layout, pixel |
| `G` | Gradient | vector, layout, pixel |
| `H` | Chart | layout |
| `H` | Hand | vector, pixel, layout |
| `I` | Color Picker | vector, pixel, layout |
| `I` | Image Frame | layout |
| `J` | Spot Healing | pixel |
| `L` | Freehand Lasso | pixel |
| `L` | Polygonal Lasso | pixel |
| `M` | Elliptical Marquee | pixel |
| `M` | Rectangle | vector, layout, pixel |
| `M` | Rectangular Marquee | pixel |
| `N` | Pencil | vector, layout |
| `O` | Blur | pixel |
| `O` | Sharpen | pixel |
| `O` | Smudge | pixel |
| `P` | Pen | vector, layout, pixel |
| `Q` | Liquify | pixel |
| `R` | Red Eye Removal | pixel |
| `S` | Clone Stamp | pixel |
| `S` | Healing Brush | pixel |
| `S` | Slice | vector, layout |
| `T` | Artistic Text | vector, pixel, layout |
| `T` | Text Frame | layout |
| `V` | Move | vector, pixel, layout |
| `W` | Color Range | pixel |
| `W` | Magic Wand | pixel |
| `Z` | Zoom | vector, pixel, layout |

## Command shortcuts

### Edit, arrange and view

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Copy | `Mod+C` |  | `edit.copy` |
| Cut | `Mod+X` |  | `edit.cut` |
| Delete | `Delete` | `Backspace` | `edit.delete` |
| Deselect | `Mod+D` |  | `edit.deselect` |
| Duplicate | `Mod+J` |  | `edit.duplicate` |
| Paste | `Mod+V` |  | `edit.paste` |
| Paste in Place | `Mod+Shift+V` |  | `edit.pasteInPlace` |
| Redo | `Mod+Shift+Z` | `Mod+Y` | `edit.redo` |
| Select All | `Mod+A` |  | `edit.selectAll` |
| Settings… | `Mod+,` |  | `edit.preferences` |
| Undo | `Mod+Z` |  | `edit.undo` |

### File and documents

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Close | `Mod+W` |  | `file.close` |
| Export… | `Mod+Shift+E` |  | `file.export` |
| Lock OpenFini | `Mod+Alt+L` |  | `file.lock` |
| New… | `Mod+N` |  | `file.new` |
| Open Folder… | `Mod+Shift+O` |  | `file.openFolder` |
| Open… | `Mod+O` |  | `file.open` |
| Place Image… | `Mod+Shift+P` |  | `file.place` |
| Save | `Mod+S` |  | `file.save` |
| Save All | `Mod+Alt+S` |  | `file.saveAll` |
| Save As… | `Mod+Shift+S` |  | `file.saveAs` |

### Windows

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| New Window | `Mod+Shift+Alt+N` |  | `window.new` |

### Pixel studio

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Fill with Background | `Mod+Backspace` |  | `pixel.fillBackground` |
| Fill with Foreground | `Alt+Backspace` |  | `pixel.fillForeground` |

### Code studio

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Close Editor | `Mod+W` |  | `code.closeTab` |
| Code View | `Mod+Alt+3` |  | `code.viewCode` |
| Copy | `Mod+C` |  | `code.copy` |
| Cut | `Mod+X` |  | `code.cut` |
| Delete Element | `Delete` | `Backspace` | `code.deleteElement` |
| Design View | `Mod+Alt+1` |  | `code.viewDesign` |
| Duplicate Element | `Mod+D` |  | `code.duplicateElement` |
| Find in File | `Mod+F` |  | `code.find` |
| Find in Files | `Mod+Shift+F` |  | `code.findInFiles` |
| Format Document | `Shift+Alt+F` |  | `code.format` |
| Go to Element… | `Mod+Shift+O` |  | `code.gotoElement` |
| Go to File… | `Mod+P` |  | `code.quickOpen` |
| Go to Line… | `Mod+G` |  | `code.gotoLine` |
| Measure Tool | `M` |  | `code.measure` |
| New File… | `Mod+Alt+N` |  | `code.newFile` |
| Paste | `Mod+V` |  | `code.paste` |
| Preview Zoom In | `Mod+=` |  | `code.zoomIn` |
| Preview Zoom Out | `Mod+-` |  | `code.zoomOut` |
| Preview Zoom: 100% | `Mod+1` |  | `code.zoom100` |
| Redo | `Mod+Shift+Z` | `Mod+Y` | `code.redo` |
| Reload Preview | `Mod+Alt+R` |  | `code.reload` |
| Show All Commands | `Mod+Shift+P` |  | `code.palette` |
| Split View | `Mod+Alt+2` |  | `code.viewSplit` |
| Toggle Console and Problems | `Mod+J` |  | `code.toggleBottom` |
| Toggle Design Mode / Live Preview | `Mod+Alt+P` |  | `code.previewMode` |
| Toggle Line Comment | `Mod+/` |  | `code.toggleComment` |
| Toggle Sidebar | `Mod+B` |  | `code.toggleSidebar` |
| Toggle Word Wrap | `Alt+Z` |  | `code.wordWrap` |
| Undo | `Mod+Z` |  | `code.undo` |

### Office studio

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Actual Size | `Mod+0` |  | `office.zoom100` |
| Align Left | `Mod+L` |  | `office.alignLeft` |
| Align Right | `Mod+R` |  | `office.alignRight` |
| Bold | `Mod+B` |  | `office.bold` |
| Bulleted List | `Mod+Shift+L` |  | `office.bullets` |
| Center | `Mod+E` |  | `office.alignCenter` |
| Clear Formatting | `Mod+Space` |  | `office.clearFormatting` |
| Decrease Indent | `Mod+[` |  | `office.outdent` |
| Find… | `Mod+F` |  | `office.find` |
| Footnote… | `Mod+Alt+F` |  | `office.insertFootnote` |
| Heading 1 | `Mod+Alt+1` |  | `office.heading1` |
| Heading 2 | `Mod+Alt+2` |  | `office.heading2` |
| Heading 3 | `Mod+Alt+3` |  | `office.heading3` |
| Increase Indent | `Mod+]` |  | `office.indent` |
| Italic | `Mod+I` |  | `office.italic` |
| Justify | `Mod+J` |  | `office.justify` |
| Link… | `Mod+K` |  | `office.insertLink` |
| Normal Text | `Mod+Alt+0` |  | `office.normal` |
| Numbered List | `Mod+Shift+N` |  | `office.numbering` |
| Page Break | `Mod+Enter` |  | `office.insertPageBreak` |
| Paste as Plain Text | `Mod+Shift+V` |  | `office.pastePlain` |
| Replace… | `Mod+H` |  | `office.replace` |
| Strikethrough | `Mod+Shift+X` |  | `office.strike` |
| Subscript | `Mod+,` |  | `office.subscript` |
| Superscript | `Mod+.` |  | `office.superscript` |
| Underline | `Mod+U` |  | `office.underline` |
| Zoom In | `Mod+=` |  | `office.zoomIn` |
| Zoom Out | `Mod+-` |  | `office.zoomOut` |

### Vibe studio

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| New Chat | `Mod+Alt+N` |  | `vibe.newChat` |
| Stop | `Escape` |  | `vibe.stop` |

### Collaboration

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Add Comment Here… | `Mod+Alt+M` |  | `collab.addCommentHere` |
| Comment Mode (click to place a comment) | `Shift+C` |  | `collab.commentMode` |
| Room Chat | `Mod+Alt+C` |  | `collab.chat` |

### Help and onboarding

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Command Palette… | `Mod+K` | `F1` | `help.palette` |
| Keyboard Shortcuts | `Mod+/` |  | `help.shortcuts` |
| Troubleshooting… | `Mod+Shift+F1` |  | `help.troubleshoot` |
| What's This? | `Shift+F1` |  | `help.whatsThis` |

### View

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| 200% | `Mod+2` |  | `view.zoom200` |
| Actual Size (100%) | `Mod+1` |  | `view.zoom100` |
| Fit All Pages | `Mod+Alt+0` |  | `view.fitAll` |
| Fit Page | `Mod+0` |  | `view.fit` |
| Grid | `Mod+'` |  | `view.grid` |
| Guides | `Mod+;` |  | `view.guides` |
| Rulers | `Mod+R` |  | `view.rulers` |
| Zoom In | `Mod+=` | `Mod++` | `view.zoomIn` |
| Zoom Out | `Mod+-` |  | `view.zoomOut` |
| Zoom to Selection | `Mod+Shift+0` |  | `view.fitSelection` |

### Arrange

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Bring Forward | `Mod+]` |  | `arrange.forward` |
| Bring to Front | `Mod+Shift+]` |  | `arrange.front` |
| Group | `Mod+G` |  | `arrange.group` |
| Hide / Show | `Mod+Shift+H` |  | `arrange.hide` |
| Lock | `Mod+L` |  | `arrange.lock` |
| Send Backward | `Mod+[` |  | `arrange.backward` |
| Send to Back | `Mod+Shift+[` |  | `arrange.back` |
| Ungroup | `Mod+Shift+G` |  | `arrange.ungroup` |

### Layer

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Edit Mask / Layer | `\\` |  | `layer.editMask` |
| Merge Down | `Mod+E` |  | `layer.mergeDown` |
| New Pixel Layer | `Mod+Shift+N` |  | `layer.newPixel` |

### Select

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Invert Selection | `Mod+Shift+I` |  | `select.invert` |

### Shape

| Command | Shortcut | Alternative | Id |
| --- | --- | --- | --- |
| Convert to Curves | `Mod+Enter` |  | `shape.convert` |

## Not in the registry

Studio switching (`Alt+1` to `Alt+5`, following the order of the studios in the header) is derived from the studio registry at run time, not from a command table. Some keys belong to the code editor (CodeMirror) or to text editing and are not commands. They are listed on [[Code Studio]] and [[Office Studio]].

## See also

- [[Customization and Profiles]]
- [[Studio Overview]]
- [[Settings Reference]]
