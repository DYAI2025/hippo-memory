# Research Directions

Hippo is an external memory system today. The mechanisms it implements have deeper implications for how LLMs learn, retain, and forget. This document maps the connections between hippo's design and open problems in machine learning research.

## The lineage

Hippo's architecture draws directly from McClelland, McNaughton & O'Reilly's Complementary Learning Systems theory (1995). That paper wasn't about brains. It was about neural networks. McClelland showed that standard neural nets suffer catastrophic forgetting: training on new data overwrites old knowledge. His solution was two complementary systems with different learning rates, one that captures experiences quickly, one that integrates them slowly through interleaved replay.

This idea has already produced major results in ML:

| Year | Technique | Neuroscience Origin | Impact |
|------|-----------|-------------------|--------|
| 2013 | Experience Replay (DQN) | Hippocampal replay during sleep | Made deep RL work for the first time |
| 2015 | Prioritized Experience Replay | Emotional tagging (amygdala) | 2x improvement in Atari benchmark |
| 2017 | Elastic Weight Consolidation | Synaptic consolidation | Reduced catastrophic forgetting in sequential tasks |
| 2021 | LoRA | Fast/slow learning systems | Efficient fine-tuning without overwriting base knowledge |
| 2024 | Continual pre-training | Schema-accelerated consolidation | Domain adaptation with knowledge retention |

Hippo implements all seven hippocampal mechanisms as software. The question is whether these mechanisms, currently external to the model, could be moved inside the training loop.

## Seven mechanisms, mapped to ML

### 1. Two-speed learning (CLS) -> Adapter + Base model

**Current state:** LoRA, QLoRA, and similar adapter methods already separate fast-learning (adapter weights) from slow-learning (frozen base). But the adapter is static after training. There's no ongoing dialogue between the two.

**Open problem:** A continual learning pipeline where the adapter captures new interactions in deployment, and a background "consolidation" process periodically distills the adapter back into the base model weights, then resets the adapter. This would give LLMs genuine ongoing learning without catastrophic forgetting.

### 2. Decay by default -> Training signal deprecation

**Current state:** All training examples are treated equally regardless of age. A 3-year-old StackOverflow answer has the same weight as yesterday's documentation update.

**Open problem:** Time-weighted training where older examples naturally contribute less unless they've been "retrieved" (cited, referenced, or matched by users). This is the forgetting curve applied to training data curation. Hippo's strength formula (exponential decay + retrieval boost) could directly weight training examples.

### 3. Retrieval strengthening -> Reinforcement from usage

**Current state:** RLHF reinforces outputs that humans prefer. But it doesn't reinforce the *knowledge* that produced those outputs.

**Open problem:** When a model retrieves and uses a piece of knowledge successfully (positive user feedback), that knowledge should be reinforced in the weights. When knowledge is retrieved but leads to negative feedback, it should be weakened. Hippo's `outcome --good/--bad` generates exactly this signal.

### 4. Emotional tagging -> Error-prioritized replay

**Current state:** Prioritized Experience Replay (Schaul et al., 2015) replays high-TD-error examples more frequently in RL. But this hasn't been systematically applied to LLM training.

**Open problem:** Continual training that over-samples from error-producing interactions. When a deployed model generates a hallucination or produces code that fails to compile, that interaction should be replayed at 2-5x the rate of successful interactions. Hippo's error-tagged memories with 2x half-life model this directly.

### 5. Sleep consolidation -> Offline distillation

**Current state:** Knowledge distillation exists (training a smaller model from a larger one). But there's no "sleep cycle" where a model consolidates its recent adapter learning into compressed, generalized knowledge.

**Open problem:** Periodic offline passes where:
1. Recent interaction logs are compressed into representative examples
2. Redundant examples are merged (like hippo's episodic-to-semantic consolidation)
3. The compressed set is used for a brief fine-tuning pass
4. The interaction buffer is cleared

This is sharp-wave ripple replay, implemented as a training pipeline.

### 6. Schema acceleration -> Curriculum-aware continual learning

**Current state:** Curriculum learning (Bengio et al., 2009) orders training examples by difficulty. But it doesn't account for what the model already knows.

**Open problem:** New training data that is consistent with the model's existing knowledge should be integrated faster (higher learning rate, fewer epochs needed). Novel or contradictory data should be learned more slowly and carefully. Hippo's schema_fit score measures exactly this: how well new information fits existing patterns.

**Measurement approach:** Compare the embedding of new training data against the model's existing knowledge (approximated by its confident outputs on related prompts). High similarity = high schema fit = faster integration.

### 7. Interference detection -> Contradiction-aware training

**Current state:** Models trained on contradictory data (e.g., "the capital of Australia is Sydney" and "the capital of Australia is Canberra") simply average the signal, often producing confidently wrong outputs.

**Open problem:** Detecting contradictions in training data before they're learned. When new data conflicts with strongly-held existing knowledge, flag it for human review rather than blindly training on it. Hippo's conflict detection mechanism (flagging memories that contradict each other) is the prototype.

## What hippo collects that nobody else has

If hippo achieves meaningful adoption, it will generate a unique dataset:

- **What memories matter over time.** Which memories get retrieved repeatedly (strong signal) vs which decay unused (noise)?
- **Outcome-labeled retrievals.** For each memory retrieval, did it help the task (positive outcome) or not (negative)? This is direct training signal for retrieval model improvement.
- **Decay curves by domain.** How quickly do different types of knowledge become irrelevant? Is a Python syntax rule more durable than an API endpoint URL? The data would tell us.
- **Consolidation patterns.** Which episodic memories naturally cluster into semantic patterns? This reveals how knowledge generalizes.
- **Error taxonomy.** What kinds of mistakes do agents make repeatedly? What memory prevents them? This is a curriculum for agent training.

This data doesn't exist anywhere else because no other tool tracks memory lifecycle. Mem0, Basic Memory, and similar tools store and retrieve. They don't track decay, retrieval frequency, outcome feedback, or consolidation.

## Near-term research opportunities

### 1. Benchmark: Memory-Augmented Agent Evaluation

Build a standardized eval: give an agent a sequence of 50 tasks in a codebase with 10 planted traps. Measure trap-hit-rate over the sequence. Compare:
- No memory (baseline)
- Static memory (CLAUDE.md/AGENTS.md)
- Hippo with full mechanics (decay, strengthening, consolidation)

Hypothesis: hippo-equipped agents improve over the sequence (learning from early mistakes), while static memory agents show no improvement.

### 2. Optimal Decay Parameters

Run sensitivity analysis on the strength formula:
- Half-life range: 1 day to 90 days
- Retrieval boost: +1 to +5 days per retrieval
- Error multiplier: 1.5x to 3x

Measure: for a given workload, which parameters maximize the signal-to-noise ratio of retrieved memories?

### 3. Consolidation Quality

Compare consolidation strategies:
- Rule-based merge (current: text overlap threshold)
- LLM-powered merge (use a model to synthesize episodic memories into a general principle)
- Embedding cluster merge (group by embedding similarity, summarize clusters)

Measure: which strategy produces semantic memories that are most useful for future retrieval?

### 4. Cross-Agent Transfer Learning

Test whether memories learned by Agent A on Project X transfer usefully to Agent B on Project Y.
- Which memory types transfer well? (language rules, tool gotchas, architectural patterns)
- Which are too project-specific to transfer? (file paths, variable names, specific API endpoints)
- Can schema_fit predict transferability?

## Long-term vision

The end state is not an external tool. It's LLMs that have hippocampal circuits built into their architecture:
- A fast-learning module that captures deployment interactions
- A consolidation process that runs during idle compute
- Decay that naturally removes outdated knowledge
- Emotional tagging that prioritizes error-corrective learning
- Retrieval that strengthens useful knowledge and weakens noise

Hippo is the prototype. The data it generates is the evidence base. The research above is the bridge.

## Related Work

### HippoRAG

[HippoRAG](https://arxiv.org/abs/2405.14831) (Gutierrez et al., 2024) applies hippocampal indexing theory to retrieval-augmented generation, using knowledge graphs as an analog to the entorhinal cortex's pattern separation. The approach is complementary but distinct from Hippo's: HippoRAG focuses on retrieval quality via graph-based indexing, while Hippo focuses on memory lifecycle (decay, consolidation, invalidation). The name overlap reflects shared neuroscience inspiration, not shared techniques.

## References

- McClelland, J.L., McNaughton, B.L., & O'Reilly, R.C. (1995). Why there are complementary learning systems in the hippocampus and neocortex. *Psychological Review*.
- Mnih, V. et al. (2013). Playing Atari with Deep Reinforcement Learning. *arXiv:1312.5602*.
- Schaul, T. et al. (2015). Prioritized Experience Replay. *arXiv:1511.05952*.
- Kirkpatrick, J. et al. (2017). Overcoming catastrophic forgetting in neural networks. *PNAS*.
- Hu, E.J. et al. (2021). LoRA: Low-Rank Adaptation of Large Language Models. *arXiv:2106.09685*.
- Tse, D. et al. (2007). Schemas and memory consolidation. *Science*.
- Frankland, P.W. et al. (2013). Hippocampal neurogenesis and forgetting. *Trends in Neurosciences*.
- Nader, K. et al. (2000). Fear memories require protein synthesis in the amygdala for reconsolidation after retrieval. *Nature*.
