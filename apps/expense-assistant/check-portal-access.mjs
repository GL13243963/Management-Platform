const endpoints = [
  ["企业统一登录", "https://iam.cscec.com/cas/login"],
  ["企业报账门户", "https://fip.cscec.com/OSPPortal/CSCPortal.jsp"],
];

async function checkEndpoint([name, url]) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();

    const location = response.headers.get("location");
    const redirected = [301, 302, 303, 307, 308].includes(response.status);
    const redirectHost = redirected && location ? new URL(location, url).hostname : "";
    const passed = response.ok || Boolean(redirectHost);
    const redirectNote = redirectHost ? `，跳转至 ${redirectHost}` : "";
    console.log(`${passed ? "通过" : "待核查"} ${name} ${new URL(url).hostname} HTTP ${response.status}${redirectNote}`);
    return passed;
  } catch (error) {
    const code = error.cause?.code ?? error.name;
    console.error(`失败 ${name} ${new URL(url).hostname} ${code}`);
    return false;
  }
}

const results = await Promise.all(endpoints.map(checkEndpoint));
process.exitCode = results.every(Boolean) ? 0 : 1;
