#!/bin/bash

# 1. Defina o caminho onde está seu projeto local
# (Use 'pwd' na pasta do projeto para descobrir o caminho completo)
PROJETO_DIR="/root/mercadia"

# 2. Defina os dados da VPS
VPS_USER="acs"
VPS_IP="librishelf.com"
VPS_PATH="~/mercadia/data/"

# --- Início da Execução ---

echo "---------------------------------" >> "$PROJETO_DIR/log_execucao.txt"
date >> "$PROJETO_DIR/log_execucao.txt"

# Entra na pasta
cd "$PROJETO_DIR" || exit

# Roda o coletor (Redireciona erros para o log)
# Dica: Às vezes o cron não acha o 'node'. Se falhar, use o caminho completo (ex: /usr/bin/node)
node index.js >> "$PROJETO_DIR/log_execucao.txt" 2>&1

# Verifica se o arquivo CSV foi criado/atualizado recentemente
if [ -f "./data/historico_cartas.csv" ]; then
    echo "📤 Enviando para VPS..." >> "$PROJETO_DIR/log_execucao.txt"

    # Envia para a VPS
    scp -o BatchMode=yes ./data/historico_cartas.csv "$VPS_USER@$VPS_IP:$VPS_PATH" >> "$PROJETO_DIR/log_execucao.txt" 2>&1

    echo "✅ Concluído!" >> "$PROJETO_DIR/log_execucao.txt"
else
    echo "❌ Erro: CSV não encontrado." >> "$PROJETO_DIR/log_execucao.txt"
fi
