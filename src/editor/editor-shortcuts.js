export function editorHistoryAction(event) {
    if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
    const code = event.code || ({z: 'KeyZ', y: 'KeyY'})[event.key?.toLowerCase()];
    if (code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
    if (code === 'KeyY') return 'redo';
    return null;
}

export function keepsTextHistory(target) {
    if (target.isContentEditable || target.closest('[contenteditable]')?.isContentEditable) return true;
    const field = target.closest('input, textarea');
    return !!field && (field.tagName === 'TEXTAREA' || ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(field.type));
}
