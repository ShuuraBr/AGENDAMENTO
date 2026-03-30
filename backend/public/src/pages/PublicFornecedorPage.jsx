<label style={{ display: "grid", gap: 6 }}>
  <span>Chave de acesso</span>
  <input
    inputMode="numeric"
    maxLength={44}
    value={nota.chaveAcesso}
    onChange={(e) => {
      const onlyDigits = e.target.value.replace(/\D/g, "").slice(0, 44);
      updateNota(index, "chaveAcesso", onlyDigits);
    }}
  />
</label>
