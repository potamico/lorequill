import "./properties.css";
import {
  parsePropertiesHostMessage,
  type PropertiesLabels,
  type PropertiesModel,
  type PropertiesWebviewMessage,
  type PropertyField,
  type PropertyValue,
} from "../properties-protocol";

interface VsCodeApi {
  postMessage(message: PropertiesWebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/**
 * The Properties view (`Properties`, specification §8). It shows the model the host sends and
 * reports changes as "set this field"; the host checks and writes them. Values are inserted as
 * text only, never as HTML. A field being edited keeps its input while updates arrive.
 */
const vscode = acquireVsCodeApi();
const root = document.getElementById("properties") ?? document.body;
let labels: PropertiesLabels | undefined;
let model: PropertiesModel | undefined;
let notice = "";

function post(message: PropertiesWebviewMessage): void {
  vscode.postMessage(message);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

let nextId = 0;

/** The input of one field, committing on `change` so each edit is one undo step. */
function input(field: PropertyField, id: string): HTMLElement {
  const commit = (value: PropertyValue): void => {
    post({ type: "set", key: field.key, value });
  };
  switch (field.widget) {
    case "boolean": {
      const box = element("input");
      box.type = "checkbox";
      box.id = id;
      box.checked = field.value === true;
      box.addEventListener("change", () => {
        commit(box.checked);
      });
      return box;
    }
    case "select": {
      const select = element("select");
      select.id = id;
      const current = typeof field.value === "string" ? field.value : "";
      select.append(new Option(labels?.selectNone ?? "-", ""));
      for (const option of field.options ?? []) {
        select.append(new Option(option, option));
      }
      if (current !== "" && !(field.options ?? []).includes(current)) {
        // A value outside the options is kept and shown, never replaced silently.
        select.append(new Option(`${current} (${labels?.invalidOption ?? "?"})`, current));
      }
      select.value = current;
      select.addEventListener("change", () => {
        commit(select.value);
      });
      return select;
    }
    case "text":
    case "list": {
      const area = element("textarea");
      area.id = id;
      area.rows = field.widget === "list" ? 3 : 4;
      area.value = Array.isArray(field.value)
        ? field.value.join("\n")
        : typeof field.value === "string"
          ? field.value
          : "";
      area.addEventListener("change", () => {
        commit(field.widget === "list" ? area.value.split("\n") : area.value);
      });
      return area;
    }
    case "date":
    case "string": {
      const line = element("input");
      line.type = field.widget === "date" ? "date" : "text";
      line.id = id;
      line.value = typeof field.value === "string" ? field.value : "";
      line.addEventListener("change", () => {
        commit(line.value);
      });
      line.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          line.blur();
        }
      });
      return line;
    }
  }
}

function row(field: PropertyField): HTMLElement {
  const container = element("div", "field");
  container.dataset.key = field.key;
  container.dataset.widget = field.widget;
  const id = `field-${String(nextId++)}`;
  const label = element("label", "label", field.label);
  label.htmlFor = id;
  if (field.required) {
    const mark = element("span", "required", "*");
    mark.title = labels?.required ?? "";
    label.append(mark);
  }
  if (field.label !== field.key) {
    label.title = field.key;
  }
  container.append(label);
  if (field.editable) {
    const control = input(field, id);
    if (field.missing) {
      control.setAttribute("aria-invalid", "true");
    }
    container.append(control);
  } else {
    const raw = element("code", "raw", field.raw ?? "");
    raw.id = id;
    raw.tabIndex = 0;
    container.append(raw, element("p", "hint", labels?.notEditable ?? ""));
  }
  if (field.widget === "list" && field.editable) {
    container.append(element("p", "hint", labels?.listHint ?? ""));
  }
  if (field.missing) {
    container.append(element("p", "missing", labels?.missing ?? ""));
  }
  if (field.defaultValue !== undefined) {
    const shown = Array.isArray(field.defaultValue)
      ? field.defaultValue.join(", ")
      : field.defaultValue === true
        ? (labels?.yes ?? "true")
        : String(field.defaultValue);
    const button = element("button", "default", `${labels?.insertDefault ?? ""} ${shown}`);
    button.type = "button";
    button.addEventListener("click", () => {
      post({ type: "insertDefault", key: field.key });
    });
    container.append(button);
  }
  return container;
}

/** The field the author is typing in, so a re-render can keep its input and caret. */
function focusedRow(): { key: string; widget: string; node: HTMLElement } | undefined {
  const active = document.activeElement;
  const container = active instanceof HTMLElement ? active.closest<HTMLElement>(".field") : null;
  const key = container?.dataset.key;
  const widget = container?.dataset.widget;
  return container && key !== undefined && widget !== undefined
    ? { key, widget, node: container }
    : undefined;
}

function render(): void {
  const keep = focusedRow();
  const content = element("div");
  if (!model || !labels) {
    root.replaceChildren();
    return;
  }
  if (notice !== "") {
    const box = element("p", "notice", notice);
    box.setAttribute("role", "alert");
    content.append(box);
  }
  switch (model.status) {
    case "empty":
      content.append(element("p", "empty", labels.empty));
      break;
    case "readonly": {
      content.append(element("p", "page", model.page), element("p", "readonly", labels.readonly));
      const list = element("ul", "problems");
      for (const problem of model.problems) {
        list.append(element("li", undefined, problem));
      }
      const open = element("button", undefined, labels.openSource);
      open.type = "button";
      open.addEventListener("click", () => {
        post({ type: "openSource" });
      });
      content.append(list, open);
      break;
    }
    case "ok": {
      content.append(element("p", "page", model.page));
      content.append(collectionLine(model, labels));
      for (const field of model.fields) {
        content.append(row(field));
      }
      if (model.unknown.length > 0 && model.fields.length > 0) {
        content.append(element("h3", "section", labels.unknownFields));
      }
      for (const field of model.unknown) {
        content.append(row(field));
      }
      break;
    }
  }
  if (keep) {
    const replacement = Array.from(content.querySelectorAll<HTMLElement>(".field")).find(
      (candidate) => candidate.dataset.key === keep.key && candidate.dataset.widget === keep.widget,
    );
    replacement?.replaceWith(keep.node);
  }
  root.replaceChildren(...content.childNodes);
}

function collectionLine(
  current: Extract<PropertiesModel, { status: "ok" }>,
  texts: PropertiesLabels,
): HTMLElement {
  const line = element("div", "collection");
  if (current.collections.length === 0) {
    line.append(element("span", "hint", texts.noCollection));
    return line;
  }
  const label = element("label", "label", texts.collection);
  if (current.collections.length === 1) {
    line.append(label, element("span", undefined, current.collections[0]?.label ?? ""));
    return line;
  }
  const select = element("select");
  select.id = "collection";
  label.htmlFor = select.id;
  for (const choice of current.collections) {
    select.append(new Option(choice.label, choice.id));
  }
  select.value = current.collection ?? "";
  select.addEventListener("change", () => {
    post({ type: "chooseCollection", id: select.value });
  });
  line.append(label, select, element("p", "hint", texts.ambiguous));
  return line;
}

window.addEventListener("message", (event: MessageEvent) => {
  const message = parsePropertiesHostMessage(event.data);
  if (!message) {
    return;
  }
  switch (message.type) {
    case "labels":
      labels = message.labels;
      break;
    case "model":
      model = message.model;
      notice = "";
      break;
    case "notice":
      notice = message.message;
      break;
  }
  render();
});

post({ type: "ready" });
