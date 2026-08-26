#!/bin/bash

# 1. Defina o caminho onde está seu projeto local
# (Use 'pwd' na pasta do projeto para descobrir o caminho completo)
PROJETO_DIR="/root/mercadia"

# --- Início da Execução ---

echo "---------------------------------" >> "$PROJETO_DIR/log_execucao.txt"
date >> "$PROJETO_DIR/log_execucao.txt"

# Entra na pasta
cd "$PROJETO_DIR" || exit

# Roda o coletor injetando as vars do .env nativamente (Redireciona erros para o log)
# Dica: Às vezes o cron não acha o 'node'. Se falhar, use o caminho completo (ex: /usr/bin/node)
echo "🔍 Iniciando coleta e envio direto para o PostgreSQL da VPS..." >> "$PROJETO_DIR/log_execucao.txt"

node --env-file=.env index.js >> "$PROJETO_DIR/log_execucao.txt" 2>&1

echo "✅ Concluído!" >> "$PROJETO_DIR/log_execucao.txt"
# --- Heartbeat opcional (adicionado pelo fix_mercadia.sh) ---
# Defina HEALTHCHECK_URL no seu .env (ex: uma URL do healthchecks.io ou
# cronitor.io) para receber um alerta se esse cron parar de rodar.
# Sem essa var configurada, esse bloco não faz nada.
if [ -f "$PROJETO_DIR/.env" ]; then
  HEALTHCHECK_URL=$(grep -E '^HEALTHCHECK_URL=' "$PROJETO_DIR/.env" | cut -d '=' -f2-)
fi
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  curl -fsS -m 10 --retry 2 "$HEALTHCHECK_URL" >> "$PROJETO_DIR/log_execucao.txt" 2>&1
fi
