import { AiUnavailableError } from './ai-client';
import { AnthropicAiClient } from './anthropic-ai.client';

describe('AnthropicAiClient', () => {
  const settings = {
    apiKey: 'test-key-never-sent',
    baseUrl: 'http://127.0.0.1:9',
    model: 'claude-sonnet-5-5',
    timeoutMs: 5_000,
    enabled: true,
  };
  const client = (ai: Partial<typeof settings> = {}) =>
    new AnthropicAiClient({ ai: { ...settings, ...ai } } as never);

  const question = {
    system: 'You are a condition.',
    prompt: 'Is it urgent?',
    tools: [
      {
        name: 'answer',
        description: 'Answer.',
        inputSchema: { type: 'object', properties: { holds: { type: 'boolean' } } },
      },
    ],
    require: 'answer',
  };

  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it('asks the Messages API for a tool call and returns the calls it made', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        content: [
          { type: 'text', text: 'Thinking it over.' },
          { type: 'tool_use', id: 'tu_1', name: 'answer', input: { holds: true } },
        ],
      }),
    );

    await expect(client().call(question)).resolves.toEqual([
      { name: 'answer', input: { holds: true } },
    ]);

    const [address, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(address).toBe('http://127.0.0.1:9/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'test-key-never-sent',
      'anthropic-version': '2023-06-01',
    });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 'You are a condition.',
      messages: [{ role: 'user', content: 'Is it urgent?' }],
      tools: [
        { name: 'answer', description: 'Answer.', input_schema: question.tools[0]!.inputSchema },
      ],
      tool_choice: { type: 'tool', name: 'answer' },
    });
  });

  it('lets the model choose among the tools when none is required', async () => {
    fetchMock.mockResolvedValue(reply(200, { content: [] }));

    await client().call({ ...question, require: undefined });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.tool_choice).toEqual({ type: 'any' });
  });

  it('tries once more when the service is overloaded', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(reply(529, { error: { type: 'overloaded_error' } }))
      .mockResolvedValueOnce(
        reply(200, { content: [{ type: 'tool_use', name: 'answer', input: { holds: false } }] }),
      );

    const answer = client().call(question);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(answer).resolves.toEqual([{ name: 'answer', input: { holds: false } }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says plainly when the key is refused, without repeating it', async () => {
    fetchMock.mockResolvedValue(reply(401, { error: { type: 'authentication_error' } }));

    await expect(client().call(question)).rejects.toThrow('The AI service rejected the API key.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call out at all without a key', async () => {
    await expect(client({ apiKey: null as never, enabled: false }).call(question)).rejects.toThrow(
      AiUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
