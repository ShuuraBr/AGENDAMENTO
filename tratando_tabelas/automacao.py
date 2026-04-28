import pyautogui
import time
import subprocess
import pyscreeze
import pandas as pd
import os
import sys
from io import StringIO
from datetime import datetime

# =========================
# PARA GERAR OS LOGS DO PROCESSO
# =========================
log_buffer = StringIO()
sys.stdout = log_buffer

# ==========================
# Salvando o arquivo com a data e hora da geração
# ==========================
data_hora = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
log_path = rf'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\log_agendamento_{data_hora}.txt'

# =========================
# CONFIGURAÇÕES INICIAIS
# =========================
pyscreeze.USE_IMAGE_NOT_FOUND_EXCEPTION = False
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 2

def agora(): # inserir agora 16:27 - 27/04/2026
    return datetime.now().strftime("%H:%M:%S") # inserir agora 16:27 - 27/04/2026

def cronometro(): # inserir agora 16:27 - 27/04/2026
    return time.time() # inserir agora 16:27 - 27/04/2026

BASE_PATH = r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas'

# =========================
# PASTAS DE DESTINO
# =========================
EMPRESAS = [
    ("Objetiva",   rf'{BASE_PATH}\objetiva',   "entradas_objetiva"),
    ("Ac Coelho",  rf'{BASE_PATH}\ac_coelho',  "entradas_ac_coelho"),
    ("Finitura",   rf'{BASE_PATH}\finitura',   "entradas_finitura"),
    ("Sr acabamentos", rf'{BASE_PATH}\sr_acabamentos', "entradas_sr_acabamentos"),
]

# =========================
# FUNÇÕES AUXILIARES
# =========================
def caminho_imagem(nome_arquivo):
    return rf'{BASE_PATH}\{nome_arquivo}'

def esperar_imagem(nome_imagem, confidence=0.8):
    inicio = time.time()

    while not pyautogui.locateOnScreen(
        caminho_imagem(nome_imagem),
        grayscale=True,
        confidence=confidence
    ):
        time.sleep(1)

    duracao = round(time.time() - inicio, 2)
    print(f"[{agora()}] Imagem encontrada: {nome_imagem} | Tempo: {duracao}s")

def esperar_e_clicar(nome_imagem, duplo=False, confidence=0.7):
    while True:
        localizacao = pyautogui.locateOnScreen(
            caminho_imagem(nome_imagem),
            grayscale=True,
            confidence=confidence
        )

        if localizacao:
            x, y = pyautogui.center(localizacao)

            if duplo:
                pyautogui.doubleClick(x, y)
            else:
                pyautogui.click(x, y)

            print(f"Clicou em: {nome_imagem}")
            break

        time.sleep(1)

def login_sistema():
    subprocess.Popen([r"C:\Santri\adm.exe"])

    esperar_imagem("bem_vindo.png")

    pyautogui.write("523")
    pyautogui.press("enter")

    pyautogui.write("928615phsp")
    pyautogui.press("enter")
    pyautogui.press("enter")

    esperar_imagem("santri.png")

def navegar_ate_filtros():
    pyautogui.hotkey("alt", "r", "e", "e", interval=0.5)

    pyautogui.press("enter")
    pyautogui.press("2")
    pyautogui.press("enter")
    pyautogui.press("3")
    pyautogui.press("enter")

    esperar_e_clicar("desmarcar.png")
    esperar_e_clicar("ag_chegada.png", duplo=True)
    esperar_e_clicar("secundario.png", duplo=True)
    esperar_e_clicar("observacao.png", duplo=True)

def processar_empresa(nome_empresa, pasta_destino, nome_arquivo):
    inicio_empresa = time.time() ## inserir agora 16:27 - 27/04/2026
    print(f"\n===== PROCESSANDO {nome_empresa} | INÍCIO: {agora()} =====") # inserir agora 16:27 - 27/04/2026

    # Campo observação
    esperar_e_clicar("observacao.png", duplo=True)

    pyautogui.hotkey("ctrl", "a")
    pyautogui.write(nome_empresa)

    # Processar
    esperar_e_clicar("processar.png", duplo=True)

    # Aguarda finalização
    esperar_imagem("entradas_encontradas.png")

    # inserir agora 16:27 - 27/04/2026
    inicio_exportacao = time.time()

    # Exportar planilha
    esperar_e_clicar("planilha.png")

    pyautogui.press("down")
    pyautogui.press("enter")

    # Selecionar pasta
    pyautogui.press("F4")
    pyautogui.hotkey("ctrl", "a")
    pyautogui.write(pasta_destino)
    pyautogui.press("enter")

    # Nome do arquivo
    pyautogui.press("tab", presses=7)
    pyautogui.write(nome_arquivo)

    # Salvar
    pyautogui.hotkey("alt", "l")

    # Confirma sucesso
    esperar_imagem("sucesso.png")
    pyautogui.press("enter")

    # inserir agora 16:27 - 27/04/2026
    tempo_exportacao = round(time.time() - inicio_exportacao, 2)
    print(f"[{agora()}] Exportação concluída | Tempo: {tempo_exportacao}s")
    tempo_total = round(time.time() - inicio_empresa, 2)
    print(f"[{agora()}] {nome_empresa} FINALIZADA | Tempo total: {tempo_total}s")

    # Preparar para próxima empresa
    esperar_e_clicar("filtros.png")
    esperar_e_clicar("observacao.png", duplo=True)

# =========================
# EXECUÇÃO PRINCIPAL
# =========================
inicio_geral = time.time()
login_sistema()
navegar_ate_filtros()

time.sleep(16)

for nome, pasta, arquivo in EMPRESAS:
    processar_empresa(nome, pasta, arquivo)

tempo_total = round(time.time() - inicio_geral, 2)
print(f"\n===== AUTOMAÇÃO FINALIZADA | Tempo total: {tempo_total}s =====")

# =========================
# CHAMAR TRATAMENTO
# =========================
print("\nIniciando tratamento dos arquivos...")

script_tratamento = r"H:\00 - HTML\AGENDAMENTO\tratando_tabelas\tratando.py"

resultado = subprocess.run(
    ["python", script_tratamento],
    capture_output=True,
    text=True
)

if resultado.returncode != 0:
    print("Erro ao executar tratamento:")
    print(resultado.stderr)
else:
    print("Tratamento finalizado com sucesso!")
    print(resultado.stdout)

tempo_total = round(time.time() - inicio_geral, 2)
print(f"\n===== PROCESSO COMPLETO FINALIZADO | Tempo total: {tempo_total}s =====")

# ====================================
# SALVANDO LOG
# ===================================
with open(log_path, "w", encoding="utf-8") as f:
    f.write(log_buffer.getvalue())