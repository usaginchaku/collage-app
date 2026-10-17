// Pages does not let this project set frame-ancestors response headers. Stop
// before loading the editor or its IndexedDB data when embedded in any frame.
if (window.top !== window.self) {
  document.body.className = "blocked-view";
  const message = document.createElement("p");
  message.textContent = "このアプリは単独の画面で開いてください。";
  const link = document.createElement("a");
  link.href = "./";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "ならべるを開く";
  document.body.replaceChildren(message, link);
} else {
  window.opener = null;
  await import("./app.js");
}
