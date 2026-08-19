export async function onRequest() {
  return new Response(JSON.stringify({
    ok: true,
    service: 'nuclear-frontier-edgeone',
    platform: 'EdgeOne Makers 中国站',
    time: new Date().toISOString(),
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Nuclear-Frontier-Cloud': 'edgeone',
    },
  });
}

export default onRequest;
