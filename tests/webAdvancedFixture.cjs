// Minimal DOM fixture shared by Advanced behavior tests.
function all(node) { return [node, ...node.children.flatMap(all)]; }
function el(tag, text = '', className) {
  return {tag, textContent:text, className, children:[], dataset:{}, listeners:{}, isConnected:true,
    get value() { return this._value ?? (this.tag === 'select' ? this.children[0]?.value || '' : ''); },
    set value(value) { this._value = value; },
    get childElementCount() { return this.children.length; },
    append(...nodes) { nodes.forEach(node => { node.remove(); node.parentElement = this; this.children.push(node); }); },
    prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); },
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; },
    replaceChildren(...nodes) { this.children.forEach(n => n.parentElement = null); this.children = []; this.append(...nodes); },
    insertBefore(node, next) { node.remove(); node.parentElement = this; const index = this.children.indexOf(next); this.children.splice(index < 0 ? this.children.length : index, 0, node); },
    get nextSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; },
    setAttribute(key, value) { this[key] = value; },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    emit(type, event = {}) { this.listeners[type]?.forEach(listener => listener(event)); },
    querySelector(selector) { return all(this).slice(1).find(node => selector === '[data-prompt-expand]' && node.dataset.promptExpand); },
    showModal() { this.open = true; }, close() { this.open = false; this.emit('close'); }, focus() { this.focused = true; },
    scrollIntoView(options) { this.scrollRequests ||= []; this.scrollRequests.push(options); }
  };
}
module.exports = {el, all};
