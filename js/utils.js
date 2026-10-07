// 경량 UI 유틸리티: 공통 로딩 및 알림 표시만 포함합니다.
function setLoading(show, text = '') {
  const overlay = document.getElementById('loadingOverlay');
  const textElement = document.getElementById('loadingText');
  if (!overlay) return;
  overlay.hidden = !show;
  if (show && textElement && text) textElement.textContent = text;
}

function showToast(message, type = '') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.append(toast);
  setTimeout(() => toast.remove(), 3500);
}

window.Utils = { setLoading, showToast };
