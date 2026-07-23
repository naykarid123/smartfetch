# Flujo de trabajo con Git (GitFlow)

Este proyecto sigue **GitFlow**. Este documento recoge las reglas y los comandos exactos.

## Ramas

| Rama | Vida | Propósito |
|---|---|---|
| `main` | permanente | Código en producción. Cada commit corresponde a una versión publicada y lleva su tag. |
| `develop` | permanente | Rama de integración. Contiene lo que irá en la próxima versión. |
| `feature/*` | temporal | Una funcionalidad nueva. Nace de `develop` y vuelve a `develop`. |
| `release/*` | temporal | Preparación de una versión. Nace de `develop`, se fusiona en `main` **y** en `develop`. |
| `hotfix/*` | temporal | Corrección urgente en producción. Nace de `main`, se fusiona en `main` **y** en `develop`. |

Regla de oro: **nunca se hace commit directo sobre `main` ni sobre `develop`.**

## Puesta en marcha del repositorio

```bash
git init
git add .
git commit -m "chore: configuración inicial del proyecto"
git branch -M main
git remote add origin https://github.com/naykarid123/smartfetch.git
git push -u origin main

# develop nace de main
git checkout -b develop
git push -u origin develop
```

## Ciclo de una funcionalidad

```bash
git checkout develop
git pull origin develop
git checkout -b feature/retry-aspect

# ...trabajo, commits...
git add .
git commit -m "feat(retry): reintentos automáticos con backoff exponencial"
git push -u origin feature/retry-aspect

# Pull Request feature/retry-aspect -> develop en GitHub.
# Tras aprobarse y fusionarse:
git checkout develop
git pull origin develop
git branch -d feature/retry-aspect
```

Ramas de funcionalidad sugeridas para este proyecto (una por bloque de requisitos):

- `feature/core-client` — cliente base y métodos HTTP
- `feature/timeout-aspect` — timeout con cancelación
- `feature/retry-aspect` — reintentos y estrategias de backoff
- `feature/interceptors` — interceptores de petición y respuesta
- `feature/error-handling` — jerarquía de errores tipados
- `feature/testing` — pruebas unitarias y de integración
- `feature/docs` — README, JSDoc y `example.ts`

## Ciclo de una versión

```bash
git checkout develop
git checkout -b release/1.0.0

npm version 1.0.0 --no-git-tag-version
# ajustes finales: CHANGELOG, versión en README...
git commit -am "chore(release): versión 1.0.0"

# A main
git checkout main
git merge --no-ff release/1.0.0
git tag -a v1.0.0 -m "Versión 1.0.0"
git push origin main --tags

# Y de vuelta a develop, para no perder los ajustes de la release
git checkout develop
git merge --no-ff release/1.0.0
git push origin develop

git branch -d release/1.0.0
```

## Ciclo de un hotfix

```bash
git checkout main
git checkout -b hotfix/1.0.1

# ...corrección...
git commit -am "fix(timeout): el temporizador no se limpiaba al cancelar"
npm version patch --no-git-tag-version
git commit -am "chore(release): versión 1.0.1"

git checkout main
git merge --no-ff hotfix/1.0.1
git tag -a v1.0.1 -m "Versión 1.0.1"
git push origin main --tags

git checkout develop
git merge --no-ff hotfix/1.0.1
git push origin develop

git branch -d hotfix/1.0.1
```

## Convención de mensajes de commit

Se usa [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<ámbito>): <descripción en imperativo y minúscula>
```

| Tipo | Uso |
|---|---|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de un error |
| `docs` | Solo documentación |
| `test` | Añadir o corregir pruebas |
| `refactor` | Cambio interno sin alterar el comportamiento |
| `chore` | Tareas de mantenimiento, configuración, dependencias |
| `perf` | Mejora de rendimiento |

Ejemplos reales del proyecto:

```
feat(timeout): cancelar la petición con AbortController al agotarse el plazo
fix(retry): no reintentar cuando la cancelación viene del usuario
test(integration): añadir servidor HTTP real con endpoint inestable
docs(readme): documentar las estrategias de backoff
```

## Publicación en NPM

```bash
git checkout main
npm login
npm publish --access public   # `prepublishOnly` ejecuta typecheck + tests + build
```
