# traceai

Python SDK for [trace.ai](https://use-trace-ai.vercel.app) — observability for LLM workflows.

Automatically captures tokens, latency, cost, and anomaly scores for every LLM call.

## Installation

```bash
pip install trace-ai-python              # core — manual ingest()
pip install trace-ai-python[langchain]   # + LangChain callback handler (Anthropic, OpenAI, etc.)
```

## LangChain (recommended)

Attach `TraceAICallbackHandler` to any LangChain LLM — every call is traced automatically:

```python
from traceai import Tracer
from traceai.langchain import TraceAICallbackHandler
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

tracer  = Tracer(api_key="trace_...")
handler = TraceAICallbackHandler(tracer)

llm   = ChatAnthropic(model="claude-haiku-4-5-20251001", callbacks=[handler])
chain = ChatPromptTemplate.from_template("Summarize: {text}") | llm | StrOutputParser()
chain.invoke({"text": "..."})
# → shows up in your dashboard automatically
```

Works with any LangChain-compatible provider: Anthropic, OpenAI, Gemini, Cohere, and more.

## Step naming

Pass `step_name` in config metadata to label steps in the dashboard:

```python
chain.invoke(
    {"text": "..."},
    config={"metadata": {"step_name": "summarize"}}
)
```

Without a name, the step is labeled from the serialized model name (e.g. `ChatAnthropic`).

## Multi-step pipelines

Steps inside a single `chain.invoke()` are automatically grouped into one run in the dashboard. Use `RunnableLambda` to wrap multi-step workflows:

```python
from langchain_core.runnables import RunnableLambda
from langchain_core.messages import SystemMessage, HumanMessage

def pipeline(inputs, config):
    intent = llm.invoke(
        [SystemMessage(content="Classify as: billing, technical, general."),
         HumanMessage(content=inputs["message"])],
        config={**config, "metadata": {"step_name": "classify"}},
    )
    reply = llm.invoke(
        [SystemMessage(content="You are a support agent. Be concise."),
         HumanMessage(content=inputs["message"])],
        config={**config, "metadata": {"step_name": "generate"}},
    )
    return reply.content

chain = RunnableLambda(pipeline)
chain.invoke({"message": "..."}, config={"callbacks": [handler]})
# → both steps appear under one run_id in the dashboard
```

## Manual ingest

For models outside LangChain, or to record any custom step:

```python
import time, json

start    = time.monotonic()
response = my_model.generate(prompt)
latency  = int((time.monotonic() - start) * 1000)

tracer.ingest(
    run_id        = "my-run-id",
    step_name     = "generate",
    step_index    = 0,
    model         = "my-model",
    prompt        = json.dumps({"messages": [{"role": "user", "content": prompt}]}),
    input_tokens  = response.input_tokens,
    output_tokens = response.output_tokens,
    total_tokens  = response.total_tokens,
    latency_ms    = latency,
    cost          = 0.001,
    status_success= True,
    output_code   = response.text,
)
```

`ingest()` fires in a background thread and never blocks your application.

## Configuration

```python
import os
from traceai import Tracer

tracer = Tracer(
    api_key = os.environ["TRACE_API_KEY"],
    api_url = os.environ.get("TRACE_API_URL", "https://trace-production-940c.up.railway.app"),
)
```

For local dev, add to `.env`:
```
TRACE_API_KEY=trace_...
TRACE_API_URL=http://localhost:8000
```

## Links

- [Dashboard](https://use-trace-ai.vercel.app)
- [Documentation](https://use-trace-ai.vercel.app/docs)
- [TypeScript SDK](../sdk/)
