import { Field, ObjectType } from "type-graphql"
import { User } from ".."
import { FieldError } from "./FieldError"

@ObjectType()
export class UserResponse {
  @Field(() => [FieldError], {nullable: true})
  errors?: FieldError[]

  @Field(() => User, {nullable: true})
  user?: User
}
