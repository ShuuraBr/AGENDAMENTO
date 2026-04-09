import pyautogui
import time
import subprocess
from datetime import datetime, timedelta
import pyscreeze
pyscreeze.USE_IMAGE_NOT_FOUND_EXCEPTION = False
pyautogui.FAILSAFE = True # Para parar a automação a qualquer momento leve o mouse até uma extremidade da tela
objetiva = r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\objetiva'
pyautogui.PAUSE = 2
subprocess.Popen([r"C:\Santri\adm.exe"])
while not pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\bem_vindo.png',grayscale=True, confidence=0.8):
    print("Imagem bem_vindo encontrada")
    time.sleep(5)
pyautogui.write("523")
pyautogui.press("enter")
pyautogui.write("928615phsp")
pyautogui.press("enter")
pyautogui.press("enter")
while not pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\santri.png',grayscale=True, confidence=0.8):
    print("Imagem santri encontrada")
    time.sleep(5)
pyautogui.hotkey("alt","r","e","e", interval=0.5)
pyautogui.press("enter")
pyautogui.press("2")
pyautogui.press("enter")
pyautogui.press("3")
pyautogui.press("enter")
while True:
    localizacao = pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\desmarcar.png',grayscale=True,confidence=0.7)
    if localizacao:
        x, y = pyautogui.center(localizacao)
        pyautogui.click(x, y)
        print("Imagem desmarcar encontrada")
        break  # sai do loop após clicar
    time.sleep(1)
while True:
    localizacao = pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\ag_chegada.png',grayscale=True,confidence=0.7)
    if localizacao:
        x, y = pyautogui.center(localizacao)
        pyautogui.doubleClick(x, y)
        print("Imagem desmarcar encontrada")
        break  # sai do loop após clicar
    time.sleep(1)
while True:
    localizacao = pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\secundario.png',grayscale=True,confidence=0.7)
    if localizacao:
        x, y = pyautogui.center(localizacao)
        pyautogui.doubleClick(x, y)
        print("Imagem secundario encontrada")
        break  # sai do loop após clicar
    time.sleep(1)
while True:
    localizacao = pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\observacao.png',grayscale=True,confidence=0.7)
    if localizacao:
        x, y = pyautogui.center(localizacao)
        pyautogui.doubleClick(x, y)
        print("Imagem observacao encontrada")
        break  # sai do loop após clicar
    time.sleep(1)
time.sleep(16)
pyautogui.write("Objetiva")
while True:
    localizacao = pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\processar.png',grayscale=True,confidence=0.7)
    if localizacao:
        x, y = pyautogui.center(localizacao)
        pyautogui.doubleClick(x, y)
        print("Imagem processar encontrada")
        break  # sai do loop após clicar
    time.sleep(1)
while True:
    localizacao = pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\planilha.png',grayscale=True,confidence=0.7)
    if localizacao:
        x, y = pyautogui.center(localizacao)
        pyautogui.click(x, y)
        print("Imagem processar encontrada")
        break  # sai do loop após clicar
    time.sleep(1)
time.sleep(2)
pyautogui.press("down")
pyautogui.press("enter")
pyautogui.press("F4") #Para selecionar a barra de endereço
pyautogui.hotkey("ctrl","A")
pyautogui.write(objetiva)
time.sleep(1)
pyautogui.press("enter")
pyautogui.press('tab', presses=7) #Apertando o Tab até encontrar a parte do nome do arquivo
pyautogui.write("entradas_objetiva") #Inserindo o nome do arquivo
while not pyautogui.locateOnScreen(r'H:\00 - HTML\AGENDAMENTO\tratando_tabelas\sucesso.png',grayscale=True, confidence=0.8):
    print("tabela_objetiva salva")
    time.sleep(5)
pyautogui.press("enter")
