/**
 * GeographyService — wraps the read paths with a 24h Redis cache
 * (SPEC §6.28 / Step 6 prompt) and invalidates on writes.
 *
 * Cache keys mirror SPEC §17.2 patterns:
 *   cache:geography:states          → JSON array of State
 *   cache:geography:cities:{state}  → JSON array of City for the state
 *
 * Reads fall through to the repository on miss and SET-EX the result with a
 * 24h TTL. Any state/city write DEL's the relevant key(s).
 */

import { Injectable } from '@nestjs/common';

import { AppError, ERROR_CODES } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import { GeographyRepository } from '../../db/repositories';

import type { City, NewCity, NewState, State } from '../../db/schema';

const STATES_KEY = 'cache:geography:states';
const cityKey = (stateId: string) => `cache:geography:cities:${stateId}`;
const TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class GeographyService {
  constructor(
    private readonly repo: GeographyRepository,
    private readonly redis: RedisService,
  ) {}

  // ----- reads (cached) ---------------------------------------------------
  async listStates(): Promise<State[]> {
    const cached = await this.redis.cacheClient.get(STATES_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as State[];
      } catch {
        // fall through
      }
    }
    const rows = await this.repo.listStates();
    await this.redis.cacheClient.set(STATES_KEY, JSON.stringify(rows), 'EX', TTL_SECONDS);
    return rows;
  }

  async listCitiesByState(stateId: string): Promise<City[]> {
    const state = await this.repo.findStateById(stateId);
    if (!state) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'State not found',
        statusCode: 404,
      });
    }
    const cached = await this.redis.cacheClient.get(cityKey(stateId));
    if (cached) {
      try {
        return JSON.parse(cached) as City[];
      } catch {
        // fall through
      }
    }
    const rows = await this.repo.listCitiesByState(stateId);
    await this.redis.cacheClient.set(cityKey(stateId), JSON.stringify(rows), 'EX', TTL_SECONDS);
    return rows;
  }

  async getCity(cityId: string): Promise<City> {
    const city = await this.repo.findCityById(cityId);
    if (!city) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'City not found',
        statusCode: 404,
      });
    }
    return city;
  }

  // ----- writes (invalidate) ---------------------------------------------
  async createState(input: NewState): Promise<State> {
    const row = await this.repo.createState(input);
    await this.redis.cacheClient.del(STATES_KEY);
    return row;
  }

  async createCity(input: NewCity): Promise<City> {
    const row = await this.repo.createCity(input);
    await this.redis.cacheClient.del(cityKey(input.state_id));
    return row;
  }
}
