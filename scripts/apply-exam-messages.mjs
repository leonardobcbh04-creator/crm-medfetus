import { db } from "../backend/src/db.js";

const updates = [
  {
    code: "exame_obstetrico_inicial",
    message: `Olá, [NOME]! Tudo bem? 😊

Vimos que você está no início da gestação — esse é o momento ideal para o seu primeiro ultrassom obstétrico.

Esse exame é importante para confirmar a evolução da gestação e te dar mais segurança nesse começo 🤍

Quer que eu veja um horário pra você?`
  },
  {
    code: "morfologico_1_trimestre",
    message: `Olá, [NOME]! 😊

Você está entrando no período ideal para o morfológico do 1º trimestre.

Esse exame é muito importante nessa fase, pois avalia a formação inicial do bebê com bastante detalhe.

Se quiser, posso te ajudar a agendar nos melhores horários 💙`
  },
  {
    code: "obstetrica_sexo",
    message: `Olá, [NOME]! Tudo bem? 😊

Você já está na fase em que é possível tentar descobrir o sexo do bebê 💕

É um momento muito especial!

Se quiser, posso ver um horário pra você vir fazer esse exame com a gente 🤍`
  },
  {
    code: "morfologico_2_trimestre",
    message: `Olá, [NOME]! 😊

Você já está no momento ideal para o morfológico do 2º trimestre.

Esse é um dos exames mais importantes da gestação, pois avalia o desenvolvimento do bebê com mais detalhes.

Temos horários disponíveis — quer que eu veja um pra você? 💙`
  },
  {
    code: "ecocardiograma_fetal",
    message: `Olá, [NOME]! Tudo bem? 😊

Pela fase da sua gestação, já é o momento ideal para realizar o ecocardiograma fetal.

Esse exame avalia o coração do bebê com bastante precisão e é muito importante nessa etapa 🤍

Se quiser, posso verificar horários disponíveis pra você.`
  },
  {
    code: "perfil_biofisico_fetal",
    message: `Olá, [NOME]! 😊

Você está em uma fase em que o perfil biofísico fetal pode ser indicado para acompanhar o bem-estar do bebê.

Esse exame ajuda a avaliar vários aspectos importantes da saúde do bebê nessa fase 💙

Quer que eu veja um horário disponível pra você?`
  },
  {
    code: "doppler_obstetrico",
    message: `Olá, [NOME]! Tudo bem? 😊

Pela fase da sua gestação, o Doppler obstétrico pode ser indicado para avaliar a circulação e o desenvolvimento do bebê.

É um exame importante para garantir que está tudo evoluindo bem 🤍

Se quiser, posso verificar um horário pra você.`
  },
  {
    code: "morfologico_3_trimestre",
    message: `Olá, [NOME]! 😊

Você já está entrando no período ideal para o morfológico do 3º trimestre.

Esse exame é importante para acompanhar o crescimento do bebê e verificar se está tudo evoluindo bem nessa fase final da gestação 🤍

Temos horários disponíveis — quer que eu veja um pra você?`
  },
  {
    code: "obstetrico_simples",
    message: `Olá, [NOME]! 😊

Pela fase da sua gestação, já é um bom momento para realizar um ultrassom obstétrico de acompanhamento.

Esse exame ajuda a verificar se está tudo evoluindo bem com o bebê 🤍

Se quiser, posso ver um horário pra você.`
  }
];

const now = new Date().toISOString().slice(0, 10);
const stmt = db.prepare("UPDATE exames_modelo SET default_message = ?, updated_at = ? WHERE code = ?");
updates.forEach((item) => stmt.run(item.message, now, item.code));

const rows = db.prepare("SELECT code, default_message AS defaultMessage FROM exames_modelo ORDER BY sort_order").all();
console.log(JSON.stringify(rows, null, 2));
