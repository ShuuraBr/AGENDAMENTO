import pandas as pd
import os
import subprocess
import sys
import time
import atexit
from io import StringIO
from datetime import datetime

# =========================
# LOG: garante que sobra um arquivo dizendo o que aconteceu,
# mesmo se o script travar no meio ou rodar sem ninguém olhando
# =========================
_log_buffer = StringIO()
_stdout_original = sys.stdout
_stderr_original = sys.stderr
sys.stdout = _log_buffer
sys.stderr = _log_buffer


def _salvar_log():
    sys.stdout = _stdout_original
    sys.stderr = _stderr_original
    data_hora = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_path = rf"H:\00 - HTML\AGENDAMENTO\tratando_tabelas\log_tratamento_{data_hora}.txt"
    conteudo = _log_buffer.getvalue()
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(conteudo)
    print(conteudo)


atexit.register(_salvar_log)

# =========================
# FUNÇÃO DE CONVERSÃO ODS → XLSX
# =========================
def converter_ods_para_xlsx(caminho_arquivo):
    pasta = os.path.dirname(caminho_arquivo)

    comando = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        "--headless",
        "--convert-to", "xlsx",
        caminho_arquivo,
        "--outdir", pasta
    ]

    resultado = subprocess.run(comando, capture_output=True, text=True)

    if resultado.returncode != 0:
        print("Erro na conversão:")
        print(resultado.stderr)
        return None

    caminho_xlsx = caminho_arquivo.replace(".ods", ".xlsx")

    # aguarda o arquivo existir
    timeout = 10
    inicio = time.time()

    while not os.path.exists(caminho_xlsx):
        if time.time() - inicio > timeout:
            print("Timeout na conversão!")
            return None
        time.sleep(1)

    return caminho_xlsx


# =========================
# ARQUIVOS PARA TRATAMENTO
# =========================
sintetico = {
    r"H:\00 - HTML\AGENDAMENTO\tratando_tabelas\objetiva": "objetiva",
    r"H:\00 - HTML\AGENDAMENTO\tratando_tabelas\ac_coelho": "ac coelho",
    r"H:\00 - HTML\AGENDAMENTO\tratando_tabelas\finitura": "finitura",
    r"H:\00 - HTML\AGENDAMENTO\tratando_tabelas\sr_acabamentos": "sr acabamentos"
}

dfs = []

for pasta, destino in sintetico.items():
    for arquivo in os.listdir(pasta):

        caminho_arquivo = os.path.join(pasta, arquivo)

        if arquivo.endswith(".ods"):

            print(f"\nProcessando: {caminho_arquivo}")

            try:
                # tenta ler ODS direto
                df = pd.read_excel(
                    caminho_arquivo,
                    engine="odf",
                    skiprows=3,
                    header=None,
                    dtype=str
                ).fillna("")
                df.columns = df.iloc[0]
                df = df[1:].reset_index (drop=True)
                print("Leitura ODS OK")

            except Exception as e:
                print(f"Erro no ODS: {e}")
                print("Convertendo para XLSX...")

                caminho_xlsx = converter_ods_para_xlsx(caminho_arquivo)

                if caminho_xlsx is None:
                    print("Falha na conversão. Pulando arquivo.")
                    continue

                try:
                    df = pd.read_excel(
                        caminho_xlsx,
                        skiprows=3,
                        header=None,
                        dtype=str
                    ).fillna("")

                    df.columns = df.iloc[0]
                    df = df[1:].reset_index(drop=True)

                    print("Leitura XLSX OK")

                except Exception as e2:
                    print(f"Erro ao ler XLSX: {e2}")
                    continue

            df["destino"] = destino
            dfs.append(df)

# =========================
# VALIDAÇÃO
# =========================
if not dfs:
    print("\n❌ Nenhum arquivo válido encontrado!")
    exit()

# Junta tudo
df_final = pd.concat(dfs, ignore_index=True)

# ===========================
# LIMPEZA + FILTRO
# ===========================

# Remove linhas totalmente vazias
df_final = df_final.dropna(how="all")

# Limpa espaços e quebras de linha
df_final = df_final.applymap(
    lambda x: x.strip().replace("\n", "").replace("\r", "") if isinstance(x, str) else x
)

# ===========================
# CONVERSÃO DE DATAS
# ===========================

colunas_data = [
    "Data emissão",
    "Data de Entrada",
    "Data 1º vencimento"
]

for col in df_final.columns:
    if col.strip() in colunas_data:
        df_final[col] = pd.to_datetime(
            df_final[col],
            errors="coerce",
            dayfirst=True
        )


# Garante limpeza da coluna Status
df_final["Status"] = df_final["Status"].str.strip()

# FILTRO PRINCIPAL
df_final = df_final[
    df_final["Status"] == "Ag. chegada da mercadoria"
]

# ===========================
# VISUALIZAÇÃO (opcional)
# ===========================
print("\n===== RESULTADO FILTRADO =====")
print(df_final.head(10))
print("\nTotal de registros:", len(df_final))

# ===========================
# SALVAR
# ===========================
saida = r"H:\00 - HTML\AGENDAMENTO\backend\uploads\importacao-relatorio\entradas_lojas.xlsx"

df_final.to_excel(saida, index=False)

print(f"\nArquivo salvo em:\n{saida}")

# =========================
# COMMIT E PUSH AUTOMÁTICO
# =========================
print("\nSincronizando com o Git...")

REPO_PATH = r"H:\00 - HTML\AGENDAMENTO"
ARQUIVOS_GIT = [
    r"tratando_tabelas\objetiva\entradas_objetiva.ods",
    r"tratando_tabelas\objetiva\entradas_objetiva.xlsx",
    r"tratando_tabelas\ac_coelho\entradas_ac_coelho.ods",
    r"tratando_tabelas\ac_coelho\entradas_ac_coelho.xlsx",
    r"tratando_tabelas\finitura\entradas_finitura.ods",
    r"tratando_tabelas\finitura\entradas_finitura.xlsx",
    r"tratando_tabelas\sr_acabamentos\entradas_sr_acabamentos.ods",
    r"tratando_tabelas\sr_acabamentos\entradas_sr_acabamentos.xlsx",
    r"backend\uploads\importacao-relatorio\entradas_lojas.xlsx",
]


def git(*args):
    return subprocess.run(
        ["git", "-C", REPO_PATH, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )


arquivos_existentes = [
    arquivo for arquivo in ARQUIVOS_GIT
    if os.path.exists(os.path.join(REPO_PATH, arquivo))
]
arquivos_faltando = [a for a in ARQUIVOS_GIT if a not in arquivos_existentes]
if arquivos_faltando:
    print("Aviso: os seguintes arquivos não existem e serão ignorados no commit:")
    for arquivo in arquivos_faltando:
        print(f"  - {arquivo}")

git_sync_falhou = False

resultado_add = git("add", "-f", "--", *arquivos_existentes) if arquivos_existentes else None
if resultado_add is None:
    print("Nenhum arquivo existente para adicionar ao commit.")
elif resultado_add.returncode != 0:
    print("Erro no git add:")
    print(resultado_add.stderr)
    git_sync_falhou = True
elif git("diff", "--cached", "--quiet").returncode == 0:
    print("Nenhuma alteração para commitar.")
else:
    mensagem = f"atualização banco {datetime.now().strftime('%d/%m/%Y')}"
    resultado_commit = git("commit", "-m", mensagem)
    print(resultado_commit.stdout)

    if resultado_commit.returncode != 0:
        print("Erro no git commit:")
        print(resultado_commit.stderr)
        git_sync_falhou = True
    else:
        git("fetch", "origin")
        resultado_merge = git("merge", "--no-edit", "origin/main")

        if resultado_merge.returncode != 0:
            print("Erro no git merge (conflito com origin/main, abortando):")
            print(resultado_merge.stderr)
            git("merge", "--abort")
            git_sync_falhou = True
        else:
            resultado_push = git("push", "origin", "HEAD:main")
            print(resultado_push.stdout)

            if resultado_push.returncode != 0:
                print("Erro no git push:")
                print(resultado_push.stderr)
                git_sync_falhou = True
            else:
                print("Push realizado com sucesso!")

if git_sync_falhou:
    print("\n❌ Sincronização com o Git falhou — ver mensagens de erro acima.")
    sys.exit(1)