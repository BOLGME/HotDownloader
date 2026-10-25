<template>
    <div class="credential-fields">
        <n-form-item
            v-for="field in fields"
            :key="field.key"
            :label="field.label"
            :required="!field.optional"
        >
            <n-input
                v-model:value="values[field.key]"
                :type="field.secret ? 'password' : 'text'"
                show-password-on="click"
                :placeholder="field.placeholder"
                :input-props="{
                    autocomplete: 'off',
                    spellcheck: false,
                    'aria-label': field.label,
                }"
                :disabled="disabled"
            />
        </n-form-item>
    </div>
</template>

<script setup lang="ts">
import { NFormItem, NInput } from 'naive-ui'
import type { LoginField } from '../../config/loginPlatforms'
import type { LoginValues } from '../../api/platformLoginApi'

defineProps<{ fields: LoginField[]; disabled: boolean }>()
const values = defineModel<LoginValues>({ required: true })
</script>

<style scoped>
.credential-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 16px;
}
.credential-fields > :only-child {
    grid-column: 1 / -1;
}
@media (max-width: 540px) {
    .credential-fields {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
