import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'contracts',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
