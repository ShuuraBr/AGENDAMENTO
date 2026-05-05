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

cal = Brazil()

# adicionando feriados locais (exemplo DF)
feriados_locais = [
    date(2026, 4, 21),  # Brasília
]

for f in feriados_locais:
    cal.add_holiday(f, "Feriado local")

def ultimo_dia_util(data):
    data -= timedelta(days=1)
    while not cal.is_working_day(data):
        data -= timedelta(days=1)
    return data

hoje = datetime.today().date()
ultimo_util = ultimo_dia_util(hoje)

print(ultimo_util.strftime("%d/%m/%Y"))

BASE_PATH = r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas'

def caminho_imagem(nome_arquivo):
    return rf'{BASE_PATH}\{nome_arquivo}'

def filtros_convocacao():
    pyautogui.hotkey("alt","f")
    pyautogui.hotkey("ctrl","m")
    pyautogui.write("gerenciamento de convoc")
    pyautogui.press ("enter")
    

