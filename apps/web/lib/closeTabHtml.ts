// Small confirmation page shown in the OAuth popup/tab. The Connect Accounts
// screen itself polls /api/provisioning/status and /api/connections/status for
// state changes, so this page's only job is to reassure the student and get out
// of the way — matching the "dev tool" tone from design-system.md.
export function closeTabHtml(message: string, isError = false): string {
  const color = isError ? "#A3282B" : "#000000";
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>resume-studio</title></head>
<body style="font-family: system-ui, sans-serif; background: #FFFFFF; color: ${color}; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <div style="text-align: center; max-width: 40ch;">
    <p style="font-size: 15px; line-height: 1.5;">${escapeHtml(message)}</p>
    <p style="font-family: ui-monospace, monospace; font-size: 12px; color: #6E6B76;">You can close this tab.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
