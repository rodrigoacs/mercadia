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