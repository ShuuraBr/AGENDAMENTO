import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../services/api";

function Field({ label, value }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
      <input value={value || ""} readOnly style={{ background: "#f8fafc" }} />
    </label>
  );
}

export default function PublicConsultaAgendamentoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get("token") || "");
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  async function buscar(e) {
    e?.preventDefault?.();
    if (!token) {
      setErro("Informe o token de verificação.");
      return;
    }
    setErro("");
    setResultado(null);
    setLoading(true);
    try {
      const { data } = await api.get(`/public/consulta-agendamento/${token}`);
      setResultado(data);
      setSearchParams({ token });
    } catch (err) {
      setErro(err.response?.data?.message || "Token de verificação não encontrado.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (searchParams.get("token")) buscar();
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "32px auto", fontFamily: "Arial, sans-serif", padding: "0 16px" }}>
      <h2>Verificação de agendamento</h2>
      <p style={{ color: "#475569" }}>Tela pública para fornecedor/transportadora consultar o status do agendamento. Os campos abaixo são preenchidos automaticamente pelo token de verificação enviado no voucher.</p>

      <form onSubmit={buscar} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        <input style={{ flex: 1, minWidth: 300 }} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Digite o token de verificação" />
        <button type="submit" disabled={loading}>{loading ? "Consultando..." : "Consultar agendamento"}</button>
      </form>

      {erro && <p style={{ color: "#b91c1c" }}>{erro}</p>}

      {resultado && (
        <div style={{ display: "grid", gap: 18 }}>
          <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>Dados principais</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="Protocolo" value={resultado.protocolo} />
              <Field label="Status do agendamento" value={resultado.status} />
              <Field label="Semáforo operacional" value={resultado.semaforo} />
              <Field label="Data agendada" value={new Date(`${resultado.dataAgendada}T00:00:00`).toLocaleDateString("pt-BR")} />
              <Field label="Hora agendada" value={resultado.horaAgendada} />
              <Field label="Janela" value={resultado.janela} />
              <Field label="Descrição da janela" value={resultado.janelaDescricao} />
              <Field label="Doca para descarga" value={resultado.doca} />
            </div>
          </section>

          <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>Dados da operação</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="Fornecedor" value={resultado.fornecedor} />
              <Field label="Transportadora" value={resultado.transportadora} />
              <Field label="Motorista" value={resultado.motorista} />
              <Field label="Telefone do motorista" value={resultado.telefoneMotorista} />
              <Field label="E-mail do motorista" value={resultado.emailMotorista} />
              <Field label="E-mail da transportadora/fornecedor" value={resultado.emailTransportadora} />
              <Field label="Placa do veículo" value={resultado.placa} />
              <Field label="Token de verificação" value={resultado.tokenVerificacao} />
            </div>
          </section>

          <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>Links de acompanhamento</h3>
            <div style={{ display: "grid", gap: 8 }}>
              <div><strong>Consulta deste agendamento:</strong> <a href={resultado.linkConsulta} target="_blank" rel="noreferrer">abrir</a></div>
              <div><strong>Acompanhamento do motorista:</strong> <a href={resultado.linkMotorista} target="_blank" rel="noreferrer">abrir</a></div>
              <Field label="Token do motorista" value={resultado.tokenMotorista} />
              <Field label="Token de check-in" value={resultado.tokenCheckin} />
            </div>
          </section>

          <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>Notas fiscais</h3>
            {resultado.notasFiscais?.length ? (
              <div style={{ overflowX: "auto" }}>
                <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th align="left">Número</th>
                      <th align="left">Série</th>
                      <th align="left">Chave de acesso</th>
                      <th align="left">Volumes</th>
                      <th align="left">Peso</th>
                      <th align="left">Valor NF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.notasFiscais.map((nota, index) => (
                      <tr key={`${nota.numeroNf}-${index}`} style={{ borderTop: "1px solid #e5e7eb" }}>
                        <td>{nota.numeroNf}</td>
                        <td>{nota.serie}</td>
                        <td>{nota.chaveAcesso}</td>
                        <td>{nota.volumes}</td>
                        <td>{nota.peso}</td>
                        <td>{nota.valorNf}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>Nenhuma nota fiscal vinculada.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
