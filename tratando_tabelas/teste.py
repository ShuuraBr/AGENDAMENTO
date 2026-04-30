import pyautogui
import time
import subprocess
import pyscreeze
import pandas as pd
import os
import sys
from io import StringIO
from datetime import datetime

BASE_PATH = r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas'

def caminho_imagem(nome_arquivo):
    return rf'{BASE_PATH}\{nome_arquivo}'

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


#pyautogui.hotkey("alt","f")
time.sleep(2)
pyautogui.hotkey("ctrl","M")
#time.sleep(2)
#pyautogui.write("GERENCIAMENTO")
#esperar_e_clicar("convocacao.png")


