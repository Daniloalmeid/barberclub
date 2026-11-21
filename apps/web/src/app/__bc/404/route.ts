const HTML =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta name="robots" content="noindex"><title>Página não encontrada</title></head><body><main><p>Página não encontrada.</p></main></body></html>';

export function GET() {
  return new Response(HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "x-robots-tag": "noindex",
    },
  });
}
