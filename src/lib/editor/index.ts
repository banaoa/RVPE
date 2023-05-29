// prosemirror-model 定义编辑器的文档模型，用来描述编辑器内容的数据结构
import { Schema, Node as ProsemirrorNode, DOMParser } from "prosemirror-model";
// prosemirror-view: 实现一个在浏览器中将给定编辑器状态显示为可编辑元素，并且处理用户交互的用户界面组件
import { EditorView } from "prosemirror-view";
// prosemirror-state: 提供描述编辑器整个状态的数据结构，包括selection(选择)，以及从一个状态到下一个状态的transaction(事务)
import { Command, EditorState, TextSelection, Transaction } from "prosemirror-state";
// prosemirror-commands 基本编辑命令
import { baseKeymap, selectParentNode } from "prosemirror-commands";

import { Transform } from "prosemirror-transform";

// prosemirror-keymap 键绑定
import { keymap } from "prosemirror-keymap";
// prosemirror-dropcursor 拖动光标
import { dropCursor } from "prosemirror-dropcursor";
// prosemirror-history 历史记录
import { history, redo, undo } from "prosemirror-history";
// prosemirror-inputrules 输入宏
import { undoInputRule } from "prosemirror-inputrules";

import { Change, ChangeSet, Span, simplifyChanges } from "prosemirror-changeset";

// @ts-ignore
const { computeDiff } = ChangeSet

import { recreateTransform } from "@manuscripts/prosemirror-recreate-steps";



// 基础的节点
import { Text, Doc, HardBreak, Paragraph, Blockquote, Heading, BaseNode } from "./nodes/";
// Marks 通常被用来对 inline content 增加额外的样式和其他信息. 例如加粗、斜体，跟Node的关系类似胳膊和胳膊上的纹身
import { BaseMark, Bold, Italic, Link } from "./marks/";

import { findSelectedNodeOfType } from "./utils";



// 空的doc, 用作默认值
export const emptyDocument = {
  type: "doc",
  content: [{
    type: "paragraph",
  }],
};

export interface ToolbarEntry {
  name: string,
  command: () => void,
  active: boolean,
}


export default class Editor {
  private marks: BaseMark[];
  private nodes: BaseNode[];

  private editorSchema: Schema<string, any>;
  private editorState: EditorState;
  private editorView?: EditorView;

  public onContentChange: (newContent: JSON) => void = () => {
  };
  public onToolbarChange: (toolbar: ToolbarEntry[]) => void = () => {
  };

  constructor(initialContent?: JSON) {
    this.marks = [
      new Link(),
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

  // 测试方法
  public trTestFn = ()=>{
    const editorView = this.editorView;
    console.log('editorView', editorView);

    // 获取tr, 更新tr
    /*
      // EditorState.tr 是一个 getter 函数，每次调用都会 new 一个新的。
      const state = editorView.state;
      const tr = state.tr;
      tr.delete(1, 2)
      tr.insert(0, editorView.state.doc)
      // https://prosemirror.xheldon.com/docs/ref/#state.EditorState.apply
      editorView.updateState(state.apply(tr));
    */
    // 这是一个JSON类型的doc, editorView.state.doc.toJSON()
    // {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"123123"}]}]}
    // 这是一个String类型的doc, editorView.state.doc.toString()
    // doc(paragraph("11111"))

  }

  private setCommands(): void {
    if (!this.editorView) throw new Error("rvpe: no editorView");
    const editorView = this.editorView;

    const runCommand = (command: Command): boolean => {
      const success = command(editorView.state, editorView.dispatch);
      editorView.focus();
      return success;
    }

    [...this.marks, ...this.nodes].forEach(markOrNode => {
      const command = markOrNode.getCommand(this.editorSchema);
      markOrNode.command = () => {
        return runCommand(command);
      };
    });
  }


  private get keymap(): any {
    const keymap: any = {};

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

  private get toolbar(): ToolbarEntry[] {
    return [...this.marks, ...this.nodes].filter(markOrNode => markOrNode.inToolbar).map(markOrNode => {
      return {
        name: markOrNode.name,
        command: markOrNode.command,
        active: markOrNode.isActive,
      };
    });
  }

  private dispatchTransaction(transaction: Transaction) {
    if (!this.editorView) throw new Error("rvpe: no editorView");
    const editorView = this.editorView;

    /**
     * Apply transaction
     */
    const newState = editorView.state.apply(transaction);
    // 更新内容
    editorView.updateState(newState);

    /**
     * If document changed, run content changed callback
     */
    if (transaction.before.content.findDiffStart(transaction.doc.content) !== null) {
      this.onContentChange(transaction.doc.toJSON() as JSON);
      const doc1 = transaction.before;
      const doc2 = transaction.doc;


      let trf = recreateTransform(
        doc1,
        doc2,
        true, // Whether step types other than ReplaceStep are allowed.
        false // Whether diffs in text nodes should cover entire words.
      )

      // console.log('trf', trf)


      const diff = computeDiff(transaction.before, transaction.doc, new Change(
        0,
        doc1.content.size,
        0,
        doc2.content.size,
        [new Span(doc1.content.size, 0)],
        [new Span(doc2.content.size, 0)]
      ))
      // console.log(diff);
    }

    /**
     * Update active marks and nodes
     */
    const { from, $from, to, empty } = editorView.state.selection;

    this.marks.forEach(mark => {
      const schemaMark = this.editorSchema.marks[mark.name];
      if (!schemaMark) throw new Error(`rvpe: mark ${mark.name} not found in schema`);

      mark.isActive = false;

      if (empty) {
        if (schemaMark.isInSet(editorView.state.storedMarks || $from.marks())) {
          mark.isActive = true;
        }
      }

      if (editorView.state.doc.rangeHasMark(from, to, schemaMark)) {
        mark.isActive = true;
      }
    });

    this.nodes.forEach(node => {
      const schemaNode = this.editorSchema.nodes[node.name];
      if (!schemaNode) throw new Error(`rvpe: node ${node.name} not found in schema`);

      node.isActive = false;

      const nodeInSelection = findSelectedNodeOfType(schemaNode)(editorView.state.selection);
      if (nodeInSelection && nodeInSelection.node.type.name === node.name) {
        node.isActive = true;
      }

      for (let i = $from.depth; i > 0; i -= 1) {
        const parentNode = $from.node(i);
        if (parentNode.type === schemaNode) {
          node.isActive = true;
        }
      }
    });

    this.onToolbarChange(this.toolbar);
  }

  public mount(node: Node): void {
    this.editorView = new EditorView(node, {
      state: this.editorState,
      // 当用户在编辑器中进行文本输入、删除、粘贴、撤销等操作时，编辑器会将这些操作封装成一个事务，
      // 并将其传递给 dispatchTransaction 函数。dispatchTransaction 函数会接收这个事务对象，
      // 并根据其中的内容更新编辑器的状态，包括文本内容、选区、撤销历史等。
      // 在完成状态更新后，dispatchTransaction 函数还可以触发其他的事件或更新其他的组件，以保持整个应用程序的同步。
      dispatchTransaction: this.dispatchTransaction.bind(this),
    });

    this.setCommands();

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

  public destroy(): void {
    if (this.editorView) {
      this.editorView.destroy();
    }
  }
}
