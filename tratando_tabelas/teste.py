import pyautogui
import time
import subprocess
import pyscreeze
import pandas as pd
import os
import sys
from io import StringIO
from datetime import datetime, timedelta, date
from workalendar.america import Brazil

pyscreeze.USE_IMAGE_NOT_FOUND_EXCEPTION = False
pyautogui.PAUSE=2
cal = Brazil()

def ultimo_dia_util(data):
    data -= timedelta(days=1)
    while not cal.is_working_day(data):
        data -= timedelta(days=1)
    return data

hoje = datetime.today().date()
ultimo_util = ultimo_dia_util(hoje)

print(ultimo_util.strftime("%d/%m/%Y"))

BASE_PATH = r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas'

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

def caminho_imagem(nome_arquivo):
    return rf'{BASE_PATH}\{nome_arquivo}'

def esperar_imagem(nome_imagem, timeout=5,confidence=0.8):
    inicio = time.time()

    while time.time() - inicio < timeout: 
        local = pyautogui.locateOnScreen(
            caminho_imagem(nome_imagem),
            grayscale=True,
            confidence=confidence
        )

    if local:
        duracao = round(time.time() - inicio, 2)
        return local
    time.sleep(1)
    return None

def filtros_convocacao():
    #pyautogui.hotkey("alt","f")
    pyautogui.hotkey("ctrl","m")
    pyautogui.write("gerenciamento de convoc")
    pyautogui.press ("enter")
    pyautogui.press("tab",presses=5)
    pyautogui.write(ultimo_util.strftime("%d/%m/%Y"))
    pyautogui.press("tab")
    pyautogui.write(ultimo_util.strftime("%d/%m/%Y"))

    esperar_e_clicar("baixa.png",duplo=True)
    esperar_e_clicar("processar.png")
    esperar_imagem("esperar_convocacao.png")
    esperar_e_clicar("planilha.png")
    # Selecionar pasta
    pyautogui.press("F4")
    pyautogui.hotkey("ctrl", "a")
    pyautogui.write(r'H:\00 - HTML\MAPA DE CALOR HTML\Relatorio_autom')
    pyautogui.press("enter")
        # Nome do arquivo
    pyautogui.press("tab", presses=7)
    pyautogui.write("convocacao")
        # Salvar
    pyautogui.hotkey("alt", "l")
        # Confirma sucesso
    esperar_imagem("sucesso.png")

filtros_convocacao()

