#!/usr/bin/env bun

import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const dist = path.resolve(import.meta.dirname ?? '.', '..', 'dist')

if (existsSync(dist)) {
  for (const entry of readdirSync(dist)) {
    if (entry.endsWith('.map')) unlinkSync(path.join(dist, entry))
  }
}
