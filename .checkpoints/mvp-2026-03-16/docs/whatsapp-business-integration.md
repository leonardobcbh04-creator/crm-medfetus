# Preparacao para WhatsApp Business API

O sistema ja esta preparado para receber uma integracao real no futuro, sem precisar reestruturar o fluxo atual.

## O que ja existe

- camada separada de mensageria em [backend/src/services/messaging/messagingService.js](C:\Users\Léo\Desktop\Projetos\backend\src\services\messaging\messagingService.js)
- configuracao central em [backend/src/config.js](C:\Users\Léo\Desktop\Projetos\backend\src\config.js)
- tabela `message_templates`
- tabela `message_delivery_logs`
- fluxo atual de mensagens passando pela camada de servico

## Como funciona hoje

- o sistema ainda nao envia mensagem real
- quando a recepcao registra uma mensagem, o sistema:
  - salva em `mensagens`
  - grava log em `message_delivery_logs`
  - usa provider `manual_stub`

## Onde plugar a API externa depois

O ponto principal de troca fica em:

- [backend/src/services/messaging/messagingService.js](C:\Users\Léo\Desktop\Projetos\backend\src\services\messaging\messagingService.js)

Hoje ele registra o envio manual. No futuro, esse arquivo pode:

1. montar o payload da WhatsApp Business API
2. enviar para a API externa
3. salvar `external_message_id`
4. atualizar o status do log para `enviada`, `erro` ou `respondida`

## Configuracoes previstas

As configuracoes ja previstas ficam em:

- `WHATSAPP_API_BASE_URL`
- `WHATSAPP_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Essas variaveis ja estao mapeadas em [backend/src/config.js](C:\Users\Léo\Desktop\Projetos\backend\src\config.js).

## Status previstos

Os status preparados para a camada de mensageria sao:

- `pendente`
- `enviada`
- `erro`
- `respondida`

## Tabelas novas

### `message_templates`

Guarda templates reutilizaveis para envio futuro por provider externo.

Campos principais:

- `code`
- `name`
- `channel`
- `language`
- `content`
- `active`

### `message_delivery_logs`

Guarda o historico tecnico de cada tentativa de envio.

Campos principais:

- `message_id`
- `patient_id`
- `template_id`
- `provider`
- `status`
- `external_message_id`
- `request_payload`
- `response_payload`
- `error_message`
- `sent_at`
- `delivered_at`
- `responded_at`

## Caminho recomendado para a futura integracao

1. criar um provider real para WhatsApp Business
2. trocar o provider `manual_stub` por um provider HTTP real
3. usar `message_templates` para montar mensagens aprovadas
4. registrar callbacks/webhooks da Meta para entrega e resposta
5. atualizar `message_delivery_logs` e `mensagens` a partir desses retornos
