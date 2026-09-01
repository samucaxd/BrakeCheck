---
name: telemetry-visualization-replay
description: Orienta a transformação de telemetria armazenada em séries prontas para gráfico, o alinhamento temporal para overlay entre tentativas, a curva ideal × executada, e a lógica de replay respeitando o timing original (RF-701 a RF-707). Use esta skill sempre que for transformar dados de telemetry_samples em algo exibível — gráfico, overlay ou replay — antes de qualquer decisão de estética visual, que é da simulator-ui-design.
---

# Telemetry Visualization & Replay

Cobre RF-701 a RF-707. Consome `telemetry_samples` (via `session-persistence`) e `success_criteria` de `Exercise` (via `braking-training-engine`). Produz séries de dados prontas para renderização e a lógica de reprodução temporal.

**Onde esta skill para:** entrega dados transformados e alinhados no tempo, prontos para um componente de gráfico plotar. Cor, tipografia, layout de tela e estilo visual são da `simulator-ui-design` — não decida nada de estética aqui.

## 1. Biblioteca de gráficos — decisão pendente em `brake-check-foundations`, resolvida aqui

**Escolhida: `uPlot`.** Justificativa técnica (benchmarks 2026 consultados nesta pesquisa): em streaming em tempo real de séries de linha — exatamente o caso de uso de RF-802 (telemetria ao vivo durante exercício) — `uPlot` usa ~10% de CPU e ~12MB de RAM atualizando 3.600 pontos a 60fps, contra ~40% de CPU e ~77MB do Chart.js no mesmo cenário. Como o Brake Check faz exatamente esse tipo de atualização contínua de linha (brake/throttle/steering × tempo, RF-701 a RF-703, a ~100Hz por `g29-input-layer`), a vantagem de `uPlot` em CPU/memória é diretamente relevante — não é uma otimização prematura, é o caso de uso central desta skill.

Essa decisão substitui a nota "decidir na skill telemetry-visualization-replay" deixada em `brake-check-foundations` — atualizar aquele documento se ele ainda mostrar a pendência.

## 2. Transformação de amostras brutas em séries de gráfico (RF-701 a RF-703)

Entrada: linhas de `telemetry_samples` de uma `Attempt` (`{ timestamp, brake, throttle, steering }`), ordenadas por `timestamp`. Saída: uma série por canal, com o tempo relativizado ao início da tentativa (não timestamp absoluto — sem utilidade para o piloto):

```json
{
  "attempt_id": 7291,
  "series": {
    "t_ms": [0, 10, 20, 30, ...],
    "brake": [0, 4.2, 12.8, 25.0, ...],
    "throttle": [0, 0, 0, 0, ...],
    "steering": [0, -1.0, -1.0, -2.0, ...]
  }
}
```

`t_ms[i] = telemetry_samples[i].timestamp - telemetry_samples[0].timestamp`. Um gráfico Brake × Tempo (RF-701) é `(t_ms, brake)`; Throttle × Tempo (RF-702) é `(t_ms, throttle)`; Steering × Tempo (RF-703) é `(t_ms, steering)` — mesma transformação, canal diferente.

## 3. Alinhamento temporal para overlay entre tentativas (RF-704)

Duas tentativas quase nunca têm a mesma duração nem o mesmo "tempo de preparação" antes de a frenagem começar de fato — sobrepor pelo `t_ms` relativo ao início da tentativa (seção 2) alinharia coisas erradas. Em vez disso, o alinhamento padrão usa o **início do primeiro evento de frenagem** (mesmo conceito de "evento de frenagem" já definido em `telemetry-engine` §2) como o `t=0` de referência para overlay:

```
t_aligned = t_ms − brake.events[0].start_ms
```

Se a tentativa não tiver nenhum evento de frenagem detectado (ex.: TC-203 da `telemetry-engine`, tentativa sem frenagem real), usar `t_aligned = t_ms` sem deslocamento (fallback: alinhar pelo início bruto da tentativa).

Esse mesmo alinhamento é reaproveitado em dois lugares: overlay de gráfico (RF-704) **e** comparação lado a lado dentro do replay (RF-707, seção 6) — é o mesmo problema (durações diferentes, mesmo evento de interesse) resolvido da mesma forma nos dois casos, para manter consistência entre o que a UI mostra em gráfico estático e em replay.

## 4. Curva ideal × executada (RF-705)

"Curva ideal" não é um dado que já existe pronto no catálogo da `braking-training-engine` para todo exercício — ela é **derivada** do tipo de `success_criteria` de cada um, reaproveitando as categorias já definidas em `evaluation-scoring-engine` §1:

| Tipo de critério | Curva ideal derivada |
|---|---|
| Faixa-alvo sustentada (ex.: exercícios 1, 4, 7) | Linha reta no ponto médio da faixa (`(low + high) / 2`), do início ao fim da janela exigida |
| Perfil-alvo explícito (ex.: exercício 11, "perfil-alvo decrescente") | O próprio perfil já definido no exercício — usar diretamente, sem derivar |
| Desvio de alvo único (ex.: delta de reação, overlap-alvo) | Não gera uma curva contínua útil de overlay — nesses casos, RF-705 se aplica melhor como marcador pontual (ex.: uma linha vertical no `t_aligned` esperado) do que como curva sobreposta |

A curva executada é a série real da tentativa (seção 2/3, já alinhada). Exibir as duas no mesmo eixo de tempo (`t_aligned`) é o que RF-705 pede — a decisão de estilo visual (cor, espessura, preenchimento entre as curvas) é da `simulator-ui-design`.

## 5. Replay respeitando o timing original (RF-706)

Reproduzir uma tentativa "como se estivesse acontecendo em tempo real" significa respeitar os deltas de tempo reais entre amostras consecutivas, não um framerate fixo artificial:

```
para cada par de amostras consecutivas (amostra[i], amostra[i+1]):
    delta = amostra[i+1].timestamp − amostra[i].timestamp
    aguardar `delta` ms (respeitando o delta real, mesmo que irregular)
    emitir amostra[i+1] para o componente visual
```

Isso preserva o timing original mesmo que a taxa de amostragem real tenha tido pequenas variações (jitter) durante a captura — o replay reflete o que aconteceu, não uma versão suavizada artificialmente.

## 6. Comparação Tentativa A × Tentativa B dentro do replay (RF-707)

Reaproveita o alinhamento da seção 3: os dois replays (A e B) rodam em paralelo, cada um na sua própria linha do tempo original (seção 5), mas **sincronizados por `t_aligned`** — ou seja, o relógio compartilhado do replay avança em `t_aligned`, e cada tentativa mapeia esse relógio de volta para seu próprio `t_ms` (usando o deslocamento calculado na seção 3) para saber qual amostra emitir naquele instante. Isso é o que faz TC-704 (durações diferentes, comparação ainda fazer sentido) funcionar tanto em gráfico estático quanto em replay animado, com a mesma lógica de alinhamento.

## 7. Casos de borda obrigatórios (PRD §10.7)

- **TC-701:** a transformação da seção 2 é 1:1 com os dados brutos — nenhuma escala synthetic ou interpolação deve ser introduzida sem necessidade; se precisar suavizar para performance de renderização (não é o caso esperado com `uPlot` nas taxas da seção 1), isso precisa ser uma opção explícita, nunca o padrão.
- **TC-702:** overlay curva ideal × executada (seção 4) — validar que os eixos batem exatamente (`t_aligned` para ambas), sem deslocamento acidental entre elas.
- **TC-703:** replay reproduz ordem e timing originais (seção 5) — validar que o delta entre frames do replay bate com o delta real de `telemetry_samples`, não com um intervalo fixo.
- **TC-704:** comparação A×B com durações diferentes (seção 6) — validar com duas tentativas de duração bem diferente que o `t_aligned` compartilhado realmente as torna comparáveis (o evento de frenagem de ambas cai no mesmo ponto do eixo).

## 8. Assunções provisórias registradas (ajustáveis)

- **Ponto de alinhamento padrão (`início do primeiro evento de frenagem`)** — é a interpretação mais útil para exercícios de frenagem, mas exercícios futuros (V2+, fora de escopo) podem precisar de outro ponto de referência (ex.: início do esterçamento). Revisar se a `braking-training-engine` ganhar exercícios que não começam com frenagem.
- **Fallback sem evento de frenagem detectado** — alinhar pelo início bruto da tentativa (seção 3); é uma escolha razoável, não testada contra um caso real desse tipo.
