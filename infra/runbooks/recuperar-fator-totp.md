# Recuperar o fator TOTP de um dono

Quem executa é o superadmin, com o Danilo. Não grava a senha nem o segredo do fator. O segredo, a semente e o código não são lidos nem impressos.

1. Confirmar a identidade por um canal que já esteja cadastrado na conta, além do e-mail. O WhatsApp do dono já registrado vale quando a pessoa responde naquele número e confirma que pediu a troca. E-mail sozinho não basta.
2. Anotar o `user_id` e os ids dos fatores TOTP antes de apagar. Não anotar segredo.
3. No GoTrue de produção, com a chave `service_role` lida de arquivo e não de argumento, apagar só esses fatores de tipo `totp`.
4. O dono entra de novo em `https://barber.workloop.com.br/login`. A tela de cadastro pede um fator novo. O fator antigo deixa de valer.
5. Sem o `service_role`, não há outro caminho nesta milestone. Não criar fator à mão no SQL.
