import { Schema, Node as ProsemirrorNode, DOMParser } from "prosemirror-model";
import { baseKeymap, Command, Keymap, selectParentNode } from "prosemirror-commands";
import { EditorView } from "prosemirror-view";
import { EditorState, Transaction } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { dropCursor } from "prosemirror-dropcursor";
import { history, redo, undo } from "prosemirror-history";
import { undoInputRule } from "prosemirror-inputrules";

import { Text, Doc, HardBreak, Paragraph, Blockquote, Heading, BaseNode } from "./nodes/";
import { Bold, Italic, BaseMark } from "./marks/";

export const emptyDocument = {
  type: "doc",
  content: [{
    type: "paragraph",
  }],
};


export default class Editor {
  private marks: BaseMark[];
  private nodes: BaseNode[];

  private editorSchema: Schema<string, any>;
  private editorState: EditorState;
  private editorView?: EditorView;

  public onContentChange: (newContent: JSON) => void = () => {};
  public onToolbarChange: (toolbar: any) => void = () => {};

  constructor(initialContent?: JSON) {
    this.marks = [
      new Bold(),
      new Italic(),
    ];

    this.nodes = [
      new Text(),
      new Doc(),
      new HardBreak(),
      new Paragraph(),
      new Blockquote(),
      new Heading(),
    ];

    this.editorSchema = this.createSchema();
    this.editorState = this.createState(initialContent);
  }

  private setMarkCommands(): void {
    if (!this.editorView) throw new Error("rvpe: no editorView");
    const editorView = this.editorView;

    const runCommand = (command: Command): boolean => {
      const success = command(editorView.state, editorView.dispatch);
      editorView.focus();
      return success;
    }

    this.marks.forEach(mark => {
      const command = mark.getCommand(this.editorSchema);
      mark.command = () => {
        return runCommand(command);
      };
    });
  }

  private get keymap(): Keymap {
    const keymap: Keymap = {};

    keymap["Mod-z"] = undo;
    keymap["Shift-Mod-z"] = redo;
    keymap["Escape"] = selectParentNode;
    keymap["Backspace"] = undoInputRule;
    if (typeof navigator === "undefined" || !(/Mac/.test(navigator.platform))) keymap["Mod-y"] = redo;

    this.marks.filter(mark => mark.keymaps).map(mark => {
      (mark.keymaps).forEach(mark_keymap => {
        keymap[mark_keymap] = mark.getCommand(this.editorSchema);
      });
    });

    this.nodes.filter(node => node.keymaps).map(node => {
      (node.keymaps).forEach(node_keymap => {
        keymap[node_keymap] = node.getCommand(this.editorSchema);
      });
    });

    return keymap;
  }

  private createState(content?: JSON): EditorState {
    const schema = this.editorSchema;
    const doc = this.createDocument(content);

    return EditorState.create({
      schema,
      doc,
      plugins: [
        keymap(this.keymap),
        keymap(baseKeymap),
        // @ts-ignore
        dropCursor({ class: "rvpe-dropcursor" }),
        history(),
      ],
    });
  }

  private createDocument(content?: JSON): ProsemirrorNode {
    if (typeof content === "object") {
      try {
        return this.editorSchema.nodeFromJSON(content);
      } catch (error) {
        console.warn("rvpe: Invalid content.", "Content:", content, "Error:", error);
        return this.editorSchema.nodeFromJSON(emptyDocument);
      }
    }
    return this.editorSchema.nodeFromJSON(emptyDocument);
  }

  private createDocumentFromHTML(content: string): ProsemirrorNode {
    const htmlString = `<div>${content}</div>`;
    const parser = new window.DOMParser();
    const element = parser.parseFromString(htmlString, "text/html").body.firstElementChild;
    return DOMParser.fromSchema(this.editorSchema).parse(element as Node);
  }

  private get marksSchema() {
    return this.marks.reduce((marks, { name, schema }) => ({
      ...marks,
      [name]: schema,
    }), {});
  }

  private get nodesSchema() {
    return this.nodes.reduce((nodes, { name, schema }) => ({
      ...nodes,
      [name]: schema,
    }), {});
  }

  private createSchema(): Schema {
    return new Schema({ marks: this.marksSchema, nodes: this.nodesSchema });
  }

  private get toolbar(): any {
    const toolbarMarks = this.marks.filter(mark => mark.inToolbar)
    return toolbarMarks.map(mark => {
      return {
        name: mark.name,
        command: mark.command,
        active: mark.isActive,
      };
    });
  }

  private dispatchTransaction(transaction: Transaction) {
    if (!this.editorView) throw new Error("rvpe: no editorView");

    /**
     * Apply transaction
     */
    const newState = this.editorView.state.apply(transaction);
    this.editorView.updateState(newState);

    /**
     * If document changed, run content changed callback
     */
    if (transaction.before.content.findDiffStart(transaction.doc.content) !== null) {
      this.onContentChange(transaction.doc.toJSON() as JSON);
    }

    /**
     * Update active marks and nodes
     */
    const { from, $from, to, empty } = this.editorView.state.selection;

    this.marks.forEach(mark => {
      if (!this.editorView) throw new Error("rvpe: no editorView");

      const schemaMark = this.editorSchema.marks[mark.name];
      if (!schemaMark) throw new Error(`rvpe: mark ${mark.name} not found in schema`);

      mark.isActive = false;

      if (empty) {
        if (schemaMark.isInSet(this.editorView.state.storedMarks || $from.marks())) {
          mark.isActive = true;
        }
      }

      if (this.editorView.state.doc.rangeHasMark(from, to, schemaMark)) {
        mark.isActive = true;
      }
    });

    this.onToolbarChange(this.toolbar);


    /*
    commands.value.map(command => command.active = false);

    Object.entries(schema.nodes).forEach(([nodeName, nodeType]) => {
      if (!toolbarCommandNames.includes(nodeName)) return;

      const node = findSelectedNodeOfType(nodeType)(view.state.selection);
      if (node && node.node.type.name === nodeName) {
        commands.value.find(command => command.name === nodeName).active = true;
      }

      for (let i = $from.depth; i > 0; i -= 1) {
        const n = $from.node(i);
        if (n.type === nodeType) {
          commands.value.find(command => command.name === nodeName).active = true;
        }
      }
    });
    */
  }

  public mount(node: Node): void {
    this.editorView = new EditorView(node, {
      state: this.editorState,
      dispatchTransaction: this.dispatchTransaction.bind(this),
    });

    this.setMarkCommands();

    this.onContentChange(this.editorView.state.doc.toJSON() as JSON);
    this.onToolbarChange(this.toolbar);
  }

  public setContent(newContent: JSON): boolean {
    if (!this.editorView) throw new Error("rvpe: no editorView");

    if (JSON.stringify(newContent) === JSON.stringify(this.editorView.state.doc.toJSON())) {
      return false;
    }

    this.editorState = this.createState(newContent);
    this.editorView.updateState(this.editorState);
    return true;
  }
}