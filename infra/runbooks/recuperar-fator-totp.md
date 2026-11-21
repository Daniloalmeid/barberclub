# Recuperar o fator TOTP de um dono

Quem executa é o superadmin, com o Danilo. Não grava a senha nem o segredo do fator no log.

1. Confirmar o e-mail da conta com o dono.
2. No GoTrue de produção, com a chave `service_role` lida de arquivo e não de argumento, listar os fatores do usuário e apagar os de tipo `totp`.
3. O dono entra de novo em `https://barber.workloop.com.br/login`. A tela de cadastro pede um fator novo. O fator antigo deixa de valer.
4. Sem o `service_role`, não há outro caminho nesta milestone. Não criar fator à mão no SQL.
