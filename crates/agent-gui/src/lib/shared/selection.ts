// 桌面端全局 user-select:none 下，描述类文本用 select-text 放开选中（配合系统级划词翻译）。
// 这些文本通常嵌在可点击卡片里：划选文字松开鼠标时不应触发卡片点击，纯点击则照常冒泡。
export function stopClickWhenTextSelected(event: { stopPropagation: () => void }) {
  if (window.getSelection()?.toString()) {
    event.stopPropagation();
  }
}
