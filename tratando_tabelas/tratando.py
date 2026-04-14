import pandas as pd
import os
import subprocess
import time

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
