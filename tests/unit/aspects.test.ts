import { SmartFetch, LoggingAspect, weave } from '../../src';
import type { Aspect, ProceedFn, RequestContext, SmartResponse } from '../../src';
import { jsonResponse, mockFetchSequence } from '../helpers/mockFetch';

describe('Programación Orientada a Aspectos', () => {
  it('teje los aspectos en el orden correcto (menor order = más externo)', async () => {
    const trace: string[] = [];

    const makeAspect = (name: string, order: number): Aspect => ({
      name,
      order,
      around: async (_ctx: RequestContext, proceed: ProceedFn): Promise<SmartResponse<any>> => {
        trace.push(`entra:${name}`);
        const response = await proceed();
        trace.push(`sale:${name}`);
        return response;
      },
    });

    const context = { config: {}, attempt: 1, startedAt: 0, meta: {} } as unknown as RequestContext;
    const core: ProceedFn = async () => {
      trace.push('núcleo');
      return {} as SmartResponse<unknown>;
    };

    await weave([makeAspect('interno', 50), makeAspect('externo', 10)], core, context)();

    expect(trace).toEqual([
      'entra:externo',
      'entra:interno',
      'núcleo',
      'sale:interno',
      'sale:externo',
    ]);
  });

  it('ejecuta los cinco advices en el orden esperado (caso de éxito)', async () => {
    const trace: string[] = [];
    const aspect: Aspect = {
      name: 'trazador',
      before: () => void trace.push('before'),
      afterReturning: () => void trace.push('afterReturning'),
      afterThrowing: () => void trace.push('afterThrowing'),
      after: () => void trace.push('after'),
    };

    const mock = mockFetchSequence([jsonResponse()]);
    const client = new SmartFetch({ fetchImpl: mock.fetch }).use(aspect);

    await client.get('https://api.test/x');

    expect(trace).toEqual(['before', 'afterReturning', 'after']);
  });

  it('ejecuta afterThrowing cuando la petición falla', async () => {
    const trace: string[] = [];
    const aspect: Aspect = {
      name: 'trazador',
      afterReturning: () => void trace.push('afterReturning'),
      afterThrowing: () => void trace.push('afterThrowing'),
      after: () => void trace.push('after'),
    };

    const mock = mockFetchSequence([jsonResponse({ status: 500, body: {} })]);
    const client = new SmartFetch({ fetchImpl: mock.fetch }).use(aspect);

    await client.get('https://api.test/x').catch(() => undefined);

    expect(trace).toEqual(['afterThrowing', 'after']);
  });

  it('un aspecto de usuario puede cortocircuitar la petición (caché)', async () => {
    const mock = mockFetchSequence([jsonResponse({ body: { fuente: 'red' } })]);

    const cacheAspect: Aspect = {
      name: 'cache',
      order: 5,
      around: async (context, proceed) => {
        if (context.config.url.includes('/cacheado')) {
          return { data: { fuente: 'caché' }, status: 200, attempts: 0 } as SmartResponse<unknown>;
        }
        return proceed();
      },
    };

    const client = new SmartFetch({ fetchImpl: mock.fetch }).use(cacheAspect);

    const cached = await client.get<{ fuente: string }>('https://api.test/cacheado');
    expect(cached.data.fuente).toBe('caché');
    expect(mock.calls).toHaveLength(0); // nunca se tocó la red

    const fresh = await client.get<{ fuente: string }>('https://api.test/otro');
    expect(fresh.data.fuente).toBe('red');
    expect(mock.calls).toHaveLength(1);
  });

  it('LoggingAspect registra éxitos y fallos a través del logger inyectado', async () => {
    const logger = { debug: jest.fn(), info: jest.fn(), error: jest.fn() };
    const mock = mockFetchSequence([jsonResponse()]);
    const client = new SmartFetch({ fetchImpl: mock.fetch, logger }).use(new LoggingAspect());

    await client.get('https://api.test/x');

    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('eject() elimina un aspecto registrado', async () => {
    const aspect: Aspect = { name: 'temporal', before: jest.fn() };
    const mock = mockFetchSequence([jsonResponse()]);
    const client = new SmartFetch({ fetchImpl: mock.fetch }).use(aspect);

    expect(client.eject('temporal')).toBe(true);
    expect(client.eject('inexistente')).toBe(false);

    await client.get('https://api.test/x');
    expect(aspect.before).not.toHaveBeenCalled();
  });
});
