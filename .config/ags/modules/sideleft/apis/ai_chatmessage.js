const { Gdk, Gio, GLib, Gtk } = imports.gi;
import GtkSource from "gi://GtkSource?version=3.0";
import App from 'resource:///com/github/Aylur/ags/app.js';
import Widget from 'resource:///com/github/Aylur/ags/widget.js';
import * as Utils from 'resource:///com/github/Aylur/ags/utils.js';
const { Box, Button, Label, Icon, Scrollable } = Widget;
const { execAsync, exec } = Utils;
import { MaterialIcon } from '../../.commonwidgets/materialicon.js';
import md2pango from '../../.miscutils/md2pango.js';

const LATEX_DIR = `${GLib.get_user_cache_dir()}/ags/media/latex`;
const CUSTOM_SOURCEVIEW_SCHEME_PATH = `${App.configDir}/assets/themes/sourceviewtheme.xml`;
const CUSTOM_SCHEME_ID = 'custom';
const USERNAME = GLib.get_user_name();
Gtk.IconTheme.get_default().append_search_path(LATEX_DIR);

/////////////////////// Custom source view colorscheme /////////////////////////

function loadCustomColorScheme(filePath) {
    // Read the XML file content
    const file = Gio.File.new_for_path(filePath);
    const [success, contents] = file.load_contents(null);

    if (!success) {
        logError('Failed to load the XML file.');
        return;
    }

    // Parse the XML content and set the Style Scheme
    const schemeManager = GtkSource.StyleSchemeManager.get_default();
    schemeManager.append_search_path(file.get_parent().get_path());
}
loadCustomColorScheme(CUSTOM_SOURCEVIEW_SCHEME_PATH);

//////////////////////////////////////////////////////////////////////////////

function substituteLang(str) {
    const subs = [
        { from: 'javascript', to: 'js' },
        { from: 'bash', to: 'sh' },
    ];

    for (const { from, to } of subs) {
        if (from === str)
            return to;
    }

    return str;
}

const HighlightedCode = (content, lang) => {
    const buffer = new GtkSource.Buffer();
    const sourceView = new GtkSource.View({
        buffer: buffer,
        wrap_mode: Gtk.WrapMode.NONE
    });
    const langManager = GtkSource.LanguageManager.get_default();
    let displayLang = langManager.get_language(substituteLang(lang)); // Set your preferred language
    if (displayLang) {
        buffer.set_language(displayLang);
    }
    const schemeManager = GtkSource.StyleSchemeManager.get_default();
    buffer.set_style_scheme(schemeManager.get_scheme(CUSTOM_SCHEME_ID));
    buffer.set_text(content, -1);
    return sourceView;
}

const TextBlock = (content = '') => Label({
    hpack: 'fill',
    className: 'txt sidebar-chat-txtblock sidebar-chat-txt',
    useMarkup: true,
    xalign: 0,
    wrap: true,
    selectable: true,
    label: content,
});

Utils.execAsync(['bash', '-c', `rm ${LATEX_DIR}/*`])
    .then(() => Utils.execAsync(['bash', '-c', `mkdir -p ${LATEX_DIR}`]))
    .catch(() => {});
const Latex = (content = '') => {
    const latexViewArea = Box({
        // vscroll: 'never',
        // hscroll: 'automatic',
        attribute: {
            render: async (self, text) => {
                if (text.length == 0) return;
                const styleContext = self.get_style_context();
                const fontSize = styleContext.get_property('font-size', Gtk.StateFlags.NORMAL);

                const timeSinceEpoch = Date.now();
                const fileName = `${timeSinceEpoch}.tex`;
                const outFileName = `${timeSinceEpoch}-symbolic.svg`;
                const scriptFileName = `${timeSinceEpoch}-render.sh`;
                const filePath = `${LATEX_DIR}/${fileName}`;
                const outFilePath = `${LATEX_DIR}/${outFileName}`;
                const scriptFilePath = `${LATEX_DIR}/${scriptFileName}`;

                Utils.writeFile(text, filePath).catch(print);
                // Since MicroTex doesn't support file path input properly, we gotta cat it
                // And escaping such a command is a fucking pain so I decided to just generate a script
                // Note: MicroTex doesn't support `&=`
                // You can add this line in the middle for debugging: echo "$text" > ${filePath}.tmp
                const renderScript = `#!/usr/bin/env bash
text=$(cat ${filePath} | sed 's/$/ \\\\\\\\/g' | sed 's/&=/=/g')
LaTeX -headless -input="$text" -output=${outFilePath} -textsize=${fontSize * 1.1} -padding=0 -maxwidth=${latexViewArea.get_allocated_width() * 0.85}
`;
                Utils.writeFile(renderScript, scriptFilePath).catch(print);
                Utils.exec(`chmod a+x ${scriptFilePath}`)
                Utils.timeout(100, () => {
                    Utils.exec(`bash ${scriptFilePath}`);
                    self.child?.destroy();
                    self.child = Gtk.Image.new_from_file(outFilePath);
                })
            }
        },
        setup: (self) => self.attribute.render(self, content).catch(print),
    });
    const wholeThing = Box({
        className: 'sidebar-chat-latex',
        homogeneous: true,
        attribute: {
            'updateText': (text) => {
                latexViewArea.attribute.render(latexViewArea, text).catch(print);
            }
        },
        children: [Scrollable({
            vscroll: 'never',
            hscroll: 'automatic',
            child: latexViewArea
        })]
    })
    return wholeThing;
}

const CodeBlock = (content = '', lang = 'txt') => {
    if (lang == 'tex' || lang == 'latex') {
        return Latex(content);
    }
    const topBar = Box({
        className: 'sidebar-chat-codeblock-topbar',
        children: [
            Label({
                label: lang,
                className: 'sidebar-chat-codeblock-topbar-txt',
            }),
            Box({
                hexpand: true,
            }),
            Button({
                className: 'sidebar-chat-codeblock-topbar-btn',
                child: Box({
                    className: 'spacing-h-5',
                    children: [
                        MaterialIcon('content_copy', 'small'),
                        Label({
                            label: 'Copy',
                        })
                    ]
                }),
                onClicked: (self) => {
                    const buffer = sourceView.get_buffer();
                    const copyContent = buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false); // TODO: fix this
                    execAsync([`wl-copy`, `${copyContent}`]).catch(print);
                },
            }),
        ]
    })
    // Source view
    const sourceView = HighlightedCode(content, lang);

    const codeBlock = Box({
        attribute: {
            'updateText': (text) => {
                sourceView.get_buffer().set_text(text, -1);
            }
        },
        className: 'sidebar-chat-codeblock',
        vertical: true,
        children: [
            topBar,
            Box({
                className: 'sidebar-chat-codeblock-code',
                homogeneous: true,
                children: [Scrollable({
                    vscroll: 'never',
                    hscroll: 'automatic',
                    child: sourceView,
                })],
            })
        ]
    })

    // const schemeIds = styleManager.get_scheme_ids();

    // print("Available Style Schemes:");
    // for (let i = 0; i < schemeIds.length; i++) {
    //     print(schemeIds[i]);
    // }
    return codeBlock;
}

const Divider = () => Box({
    className: 'sidebar-chat-divider',
})

const MessageContent = (content) => {
    const contentBox = Box({
        vertical: true,
        attribute: {
            'fullUpdate': (self, content, useCursor = false) => {
                // Clear and add first text widget
                const children = contentBox.get_children();
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    child.destroy();
                }
                contentBox.add(TextBlock())
                // Loop lines. Put normal text in markdown parser 
                // and put code into code highlighter (TODO)
                let lines = content.split('\n');
                let lastProcessed = 0;
                let inCode = false;
                for (const [index, line] of lines.entries()) {
                    // Code blocks
                    const codeBlockRegex = /^\s*```([a-zA-Z0-9]+)?\n?/;
                    if (codeBlockRegex.test(line)) {
                        const kids = self.get_children();
                        const lastLabel = kids[kids.length - 1];
                        const blockContent = lines.slice(lastProcessed, index).join('\n');
                        if (!inCode) {
                            lastLabel.label = md2pango(blockContent);
                            contentBox.add(CodeBlock('', codeBlockRegex.exec(line)[1]));
                        }
                        else {
                            lastLabel.attribute.updateText(blockContent);
                            contentBox.add(TextBlock());
                        }

                        lastProcessed = index + 1;
                        inCode = !inCode;
                    }
                    // Breaks
                    const dividerRegex = /^\s*---/;
                    if (!inCode && dividerRegex.test(line)) {
                        const kids = self.get_children();
                        const lastLabel = kids[kids.length - 1];
                        const blockContent = lines.slice(lastProcessed, index).join('\n');
                        lastLabel.label = md2pango(blockContent);
                        contentBox.add(Divider());
                        contentBox.add(TextBlock());
                        lastProcessed = index + 1;
                    }
                }
                if (lastProcessed < lines.length) {
                    const kids = self.get_children();
                    const lastLabel = kids[kids.length - 1];
                    let blockContent = lines.slice(lastProcessed, lines.length).join('\n');
                    if (!inCode)
                        lastLabel.label = `${md2pango(blockContent)}${useCursor ? userOptions.ai.writingCursor : ''}`;
                    else
                        lastLabel.attribute.updateText(blockContent);
                }
                // Debug: plain text
                // contentBox.add(Label({
                //     hpack: 'fill',
                //     className: 'txt sidebar-chat-txtblock sidebar-chat-txt',
                //     useMarkup: false,
                //     xalign: 0,
                //     wrap: true,
                //     selectable: true,
                //     label: '------------------------------\n' + md2pango(content),
                // }))
                contentBox.show_all();
            }
        }
    });
    contentBox.attribute.fullUpdate(contentBox, content, false);
    return contentBox;
}

export const ChatMessage = (message, modelName = 'Model') => {
    const messageContentBox = MessageContent(message.content);
    const thisMessage = Box({
        className: 'sidebar-chat-message',
        children: [
            Box({
                className: `sidebar-chat-indicator ${message.role == 'user' ? 'sidebar-chat-indicator-user' : 'sidebar-chat-indicator-bot'}`,
            }),
            Box({
                vertical: true,
                hpack: 'fill',
                hexpand: true,
                children: [
                    Label({
                        hpack: 'fill',
                        xalign: 0,
                        className: 'txt txt-bold sidebar-chat-name',
                        wrap: true,
                        useMarkup: true,
                        label: (message.role == 'user' ? USERNAME : modelName),
                    }),
                    messageContentBox,
                ],
                setup: (self) => self
                    .hook(message, (self, isThinking) => {
                        messageContentBox.toggleClassName('thinking', message.thinking);
                    }, 'notify::thinking')
                    .hook(message, (self) => { // Message update
                        messageContentBox.attribute.fullUpdate(messageContentBox, message.content, message.role != 'user');
                    }, 'notify::content')
                    .hook(message, (label, isDone) => { // Remove the cursor
                        messageContentBox.attribute.fullUpdate(messageContentBox, message.content, false);
                    }, 'notify::done')
                ,
            })
        ]
    });
    return thisMessage;
}

export const SystemMessage = (content, commandName, scrolledWindow) => {
    const messageContentBox = MessageContent(content);
    const thisMessage = Box({
        className: 'sidebar-chat-message',
        children: [
            Box({
                className: `sidebar-chat-indicator sidebar-chat-indicator-System`,
            }),
            Box({
                vertical: true,
                hpack: 'fill',
                hexpand: true,
                children: [
                    Label({
                        xalign: 0,
                        className: 'txt txt-bold sidebar-chat-name',
                        wrap: true,
                        label: `System  •  ${commandName}`,
                    }),
                    messageContentBox,
                ],
            })
        ],
    });
    return thisMessage;
}
