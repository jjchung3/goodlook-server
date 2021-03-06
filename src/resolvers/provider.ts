import { Resolver, Mutation, Arg, Ctx, Query } from 'type-graphql'
import { UsernamePasswordInput } from '../entities/types/UsernamePasswordInput'
import {
  validateRegisterInputs,
  filterQuery,
  GraphQLFilterType,
  distanceInput,
  distanceQuery,
  GraphQLSortType,
  sortQuery,
} from '../utils/'
import { MyContext } from '../types'
import { Provider } from '../entities'
import argon2 from 'argon2'
import { COOKIE_NAME } from '../constants'
import { getConnection } from 'typeorm'
import axios from 'axios'
import dotenv from 'dotenv'
import {
  ProviderResponse,
  ProvidersResponse,
  ProviderInput,
  AttributesInput,
} from '../entities/Provider'

dotenv.config()

/**
 * grabbing mapquest data from address inputs...
 */
const getMapQuestData = async (
  country?: String,
  state?: String,
  city?: String,
  street?: String,
  zipcode?: string
): Promise<any> => {
  let url = new URL('http://www.mapquestapi.com/geocoding/v1/address')
  let location =
    `${country ? `${country.split(/\s/).join(' ')} ` : ''}` +
    `${state ? `${state.split(/\s/).join(' ')} ` : ''}` +
    `${city ? `${city.split(/\s/).join(' ')} ` : ''}` +
    `${street ? `${street.split(/\s/).join(' ')} ` : ''}` +
    `${zipcode ? `${zipcode.split(/\s/).join(' ')}` : ''}`
  location = location || ''
  let params = [
    ['key', process.env.MAPQUEST_API || ''],
    ['maxResults', '1'],
    ['location', location],
  ]
  url.search = new URLSearchParams(params).toString()
  try {
    const result = await axios({
      method: 'get',
      url: url.toString(),
    })
    if (result.statusText === 'OK') return result.data
  } catch (err) {
    console.error(err)
    return null
  }
}

@Resolver(Provider)
export class ProviderResolver {
  @Query(() => Provider, { nullable: true })
  async meProvider(@Ctx() { req }: MyContext) {
    if (!req.session.providerId) return null
    return await getConnection()
      .getRepository(Provider)
      .findOne({
        where: {
          id: parseInt(req.session.providerId),
        },
        relations: ['reviews'],
      })
  }

  @Query(() => ProviderResponse)
  async provider(@Arg('providerId') providerId: number) {
    let provider
    //provider = Provider.findOne(providerId)
    provider = await getConnection()
      .getRepository(Provider)
      .findOne({
        where: {
          id: providerId,
        },
        relations: ['reviews'],
      })
    if (!provider) {
      return {
        errors: [
          {
            field: 'id',
            message: 'this id does not exist',
          },
        ],
      }
    }
    return { provider }
  }

  @Query(() => ProvidersResponse)
  async providers(
    @Arg('filters', () => GraphQLFilterType, { nullable: true })
    filters: typeof GraphQLFilterType,
    @Arg('sort', () => GraphQLSortType, { nullable: true })
    sort: typeof GraphQLSortType,
    @Arg('within', { nullable: true })
    distanceInput: distanceInput
  ): Promise<ProvidersResponse> {
    let providers
    try {
      const result = await getConnection()
        .getRepository(Provider)
        .createQueryBuilder()
        .leftJoinAndSelect('Provider.reviews', 'reviews')
      let augmentedQuery = filterQuery(result, filters)
      augmentedQuery = distanceInput
        ? distanceQuery(
            augmentedQuery,
            distanceInput.latitude,
            distanceInput.longitude,
            distanceInput.distance
          )
        : augmentedQuery
      // let augmentedQuery = distanceInput
      //   ? distanceQuery(
      //       result,
      //       distanceInput.latitude,
      //       distanceInput.longitude,
      //       distanceInput.distance
      //     )
      //   : result
      // augmentedQuery = filterQuery(result, filters)
      augmentedQuery = sortQuery(augmentedQuery, sort, 'Provider')
      const augmentedResult = await augmentedQuery.getMany()
      providers = augmentedResult
    } catch (err) {
      return {
        errors: [
          {
            field: 'Error',
            message: err,
          },
        ],
      }
    }
    return { providers }
  }

  @Mutation(() => ProviderResponse)
  async registerProvider(
    @Arg('input') input: UsernamePasswordInput,
    @Arg('attributesInput', { nullable: true })
    attributesInput: AttributesInput,
    @Arg('providerInput', { nullable: true }) providerInput: ProviderInput,
    @Ctx() { req }: MyContext
  ): Promise<ProviderResponse> {
    const errors = validateRegisterInputs(input)
    if (errors) return { errors }
    let provider: any
    const hashedPassword = await argon2.hash(input.password)
    let lngLat = null
    try {
      if (providerInput) {
        const mapQuestData = await getMapQuestData(
          providerInput.country || '',
          providerInput.state || '',
          providerInput.city || '',
          providerInput.street || '',
          String(providerInput.zipcode) || ''
        )
        lngLat = mapQuestData.results[0].locations[0].latLng
      }
      const result = await Provider.create({
        email: input.email,
        username: input.username,
        password: hashedPassword,
        latitude: lngLat ? lngLat.lat : undefined,
        longitude: lngLat ? lngLat.lng : undefined,
        ...attributesInput,
        ...providerInput,
      }).save()
      provider = await result.save()
    } catch (err) {
      console.error(err)
      if (err.code === '23505') {
        //duplicate username...
        return {
          errors: [
            {
              field: 'username',
              message: 'this username already exists',
            },
          ],
        }
      }
    }
    req.session.providerId = provider!.id
    return { provider }
  }

  @Mutation(() => ProviderResponse)
  async loginProvider(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('password') password: string,
    @Ctx() { req }: MyContext
  ): Promise<ProviderResponse> {
    const isEmail = usernameOrEmail.includes('@')
    const provider = await Provider.findOne(
      isEmail
        ? { where: { email: usernameOrEmail } }
        : { where: { username: usernameOrEmail } }
    )
    if (!provider && isEmail) {
      return {
        errors: [
          {
            field: 'email',
            message: 'email does not exist',
          },
        ],
      }
    }

    if (!provider && !isEmail) {
      return {
        errors: [
          {
            field: 'username',
            message: 'username does not exist',
          },
        ],
      }
    }

    const validPassword = await argon2.verify(provider!.password, password)
    if (!validPassword) {
      return {
        errors: [
          {
            field: 'password',
            message: 'incorrect password',
          },
        ],
      }
    }
    req.session.providerId = provider!.id
    return { provider }
  }

  @Mutation(() => ProviderResponse)
  async forgotProviderUsername(
    @Arg('email') email: string,
    @Arg('password') password: string,
    @Arg('newUsername') newUsername: string
  ): Promise<ProviderResponse> {
    const isEmail = email.includes('@')
    if (!isEmail) {
      return {
        errors: [
          {
            field: 'email',
            message: 'invalid email',
          },
        ],
      }
    }
    const provider = await Provider.findOne({ where: { email: email } })
    if (!provider) {
      return {
        errors: [
          {
            field: 'email',
            message: 'email does not exist',
          },
        ],
      }
    }
    const validPassword = await argon2.verify(provider!.password, password)
    if (!validPassword) {
      return {
        errors: [
          {
            field: 'password',
            message: 'incorrect password',
          },
        ],
      }
    }
    await Provider.update({ id: provider.id }, { username: newUsername })
    return { provider }
  }

  @Mutation(() => Boolean)
  async forgotProviderPassword(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('oldPassword') oldPassword: string,
    @Arg('repeatNewPassword') repeatNewPassword: string,
    @Arg('newPassword') newPassword: string
  ) {
    const isEmail = usernameOrEmail.includes('@')
    const provider = await Provider.findOne(
      isEmail
        ? { where: { email: usernameOrEmail } }
        : { where: { username: usernameOrEmail } }
    )
    if (!provider) return false
    const validPassword = await argon2.verify(provider!.password, oldPassword)
    if (!validPassword) return false
    if (newPassword !== repeatNewPassword) return false
    const response = await Provider.update(
      { id: provider!.id },
      { password: newPassword }
    )
    if (!response) return false // need to test...
    return true
  }

  @Mutation(() => Boolean)
  logoutProvider(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      req.session.destroy((err) => {
        res.clearCookie(COOKIE_NAME)
        if (err) {
          console.log(err)
          resolve(false)
          return
        }
        resolve(true)
      })
    )
  }
}
