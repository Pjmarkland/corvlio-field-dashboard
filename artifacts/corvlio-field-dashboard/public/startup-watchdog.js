(() => {
  const root = document.getElementById("root");
  if (!root) return;

  let started = false;
  const timeout = window.setTimeout(() => {
    if (!started) showFailure();
  }, 20000);

  function showFailure() {
    if (started) return;
    root.replaceChildren();

    const panel = document.createElement("main");
    panel.setAttribute("role", "alert");
    panel.style.cssText =
      "display:flex;min-height:100vh;align-items:center;justify-content:center;background:#071527;padding:24px;color:white;font-family:system-ui,sans-serif;text-align:center";

    const content = document.createElement("div");
    content.style.maxWidth = "360px";

    const title = document.createElement("h1");
    title.textContent = "Corvlio couldn’t start";
    title.style.fontSize = "20px";

    const message = document.createElement("p");
    message.textContent = "Check your connection and try again.";

    const buildInfo = document.createElement("p");
    const version =
      document.querySelector('meta[name="corvlio-app-version"]')?.content || "unknown";
    const build =
      document.querySelector('meta[name="corvlio-build-number"]')?.content || "unknown";
    buildInfo.textContent = `Version ${version} · Build ${build}`;
    buildInfo.style.cssText = "font-size:12px;opacity:.65";

    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.style.cssText =
      "min-height:44px;margin-top:16px;padding:0 20px;border:0;border-radius:12px;background:white;color:#071527;font-size:14px;font-weight:600";
    retry.addEventListener("click", () => window.location.reload());

    content.append(title, message, buildInfo, retry);
    panel.append(content);
    root.append(panel);
  }

  window.addEventListener(
    "error",
    (event) => {
      if (!started && event.target instanceof HTMLElement) showFailure();
    },
    true,
  );
  window.addEventListener("unhandledrejection", () => {
    if (!started) showFailure();
  });

  window.corvlioStartupComplete = () => {
    started = true;
    window.clearTimeout(timeout);
  };
})();
