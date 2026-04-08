import pyautogui
import time
import subprocess
from datetime import datetime, timedelta
import pyscreeze
pyscreeze.USE_IMAGE_NOT_FOUND_EXCEPTION = False
pyautogui.FAILSAFE = True # Para parar a automação a qualquer momento leve o mouse até uma extremidade da tela
pyautogui.PAUSE = 2
subprocess.Popen([r"C:\Santri\adm.exe"])
while not pyautogui.locateOnScreen(r'H:\39 - Python\bem_vindo.png',grayscale=True, confidence=0.8):
    time.sleep(5)
pyautogui.write("523")
pyautogui.press("enter")
