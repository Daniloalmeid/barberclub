# Requisitos da M4

A M1 já fixou a URL canônica. Esta página é o que a M4 tem de cumprir em cima disso.

## URL canônica sem barra final

A forma canônica de uma rota pública não tem barra no fim. A raiz continua `/`. A variante com barra final responde 308 para a sem barra, com a query preservada e `Location` relativo. Isso já vale no middleware (`docs/decisoes-m1.md`).

Quando a M4 publicar páginas indexáveis, o HTML e o sitemap usam só essa forma:

- `<link rel="canonical">` aponta para a URL sem barra final.
- O sitemap lista só a URL canônica, sem a variante com barra.
- Um teste falha se o canonical ou o sitemap apontar para a URL com barra, e se `/rota/` deixar de responder 308 com `Location: /rota`.
