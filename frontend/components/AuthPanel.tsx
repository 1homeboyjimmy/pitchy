"use client";

import {
  Button,
  Group,
  Modal,
  PasswordInput,
  Progress,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMemo, useState } from "react";
import { postJson } from "@/lib/api";
import { setToken } from "@/lib/auth";

type AuthPanelProps = {
  onAuth: () => void;
};

export function AuthPanel({ onAuth }: AuthPanelProps) {
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const loginForm = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      password: (value) =>
        value.length > 72
          ? "Пароль должен быть до 72 символов"
          : value.length < 8
            ? "Минимум 8 символов"
            : null,
    },
  });
  const registerForm = useForm({
    initialValues: { name: "", email: "", password: "" },
    validate: {
      password: (value) =>
        value.length > 72
          ? "Пароль должен быть до 72 символов"
          : value.length < 8
            ? "Минимум 8 символов"
          : !(/[A-Za-z]/.test(value) && /\d/.test(value))
            ? "Пароль должен содержать буквы и цифры"
            : null,
    },
  });

  const passwordStrength = useMemo(() => {
    const value = registerForm.values.password;
    if (!value) return { score: 0, label: "Введите пароль", color: "gray" };
    let score = 0;
    if (value.length >= 8) score += 25;
    if (/[A-Z]/.test(value)) score += 15;
    if (/[a-z]/.test(value)) score += 15;
    if (/\d/.test(value)) score += 20;
    if (/[^A-Za-z0-9]/.test(value)) score += 25;
    const clamped = Math.min(100, score);
    if (clamped >= 80) return { score: clamped, label: "Сильный", color: "green" };
    if (clamped >= 55) return { score: clamped, label: "Нормальный", color: "yellow" };
    return { score: clamped, label: "Слабый", color: "red" };
  }, [registerForm.values.password]);

  const handleLogin = loginForm.onSubmit(async (values) => {
    try {
      const data = await postJson<{ access_token: string }>("/auth/login", values);
      setToken(data.access_token);
      notifications.show({
        title: "Вы вошли",
        message: "Добро пожаловать обратно.",
        color: "green",
      });
      onAuth();
    } catch (error) {
      notifications.show({
        title: "Ошибка входа",
        message: error instanceof Error ? error.message : "Request failed",
        color: "red",
      });
    }
  });

  const handleRegister = registerForm.onSubmit(async (values) => {
    try {
      const data = await postJson<{ access_token: string }>(
        "/auth/register",
        values
      );
      setToken(data.access_token);
      notifications.show({
        title: "Регистрация завершена",
        message: "Профиль создан и вы вошли в систему.",
        color: "green",
      });
      onAuth();
    } catch (error) {
      notifications.show({
        title: "Ошибка регистрации",
        message: error instanceof Error ? error.message : "Request failed",
        color: "red",
      });
    }
  });

  const requestReset = async () => {
    try {
      await postJson("/auth/request-password-reset", { email: resetEmail });
      notifications.show({
        title: "Письмо отправлено",
        message: "Если email существует, вы получите ссылку для сброса.",
        color: "green",
      });
      setResetOpen(false);
    } catch (error) {
      notifications.show({
        title: "Ошибка",
        message: error instanceof Error ? error.message : "Request failed",
        color: "red",
      });
    }
  };

  return (
    <Stack>
      <div>
        <Title order={3}>Доступ к кабинету</Title>
        <Text size="sm" c="dimmed" mt={4}>
          Войдите или создайте аккаунт, чтобы сохранять историю и анализы.
        </Text>
      </div>

      <Tabs defaultValue="login">
        <Tabs.List>
          <Tabs.Tab value="login">Вход</Tabs.Tab>
          <Tabs.Tab value="register">Регистрация</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="login" pt="md">
          <form onSubmit={handleLogin}>
            <Stack>
              <TextInput
                label="Email"
                placeholder="you@example.com"
                {...loginForm.getInputProps("email")}
              />
              <PasswordInput
                label="Пароль"
                description="8–72 символа"
                {...loginForm.getInputProps("password")}
              />
              <Group>
                <Button type="submit">Войти</Button>
                <Button variant="subtle" onClick={() => setResetOpen(true)}>
                  Забыли пароль?
                </Button>
              </Group>
            </Stack>
          </form>
        </Tabs.Panel>

        <Tabs.Panel value="register" pt="md">
          <form onSubmit={handleRegister}>
            <Stack>
              <TextInput
                label="Имя"
                placeholder="Иван"
                {...registerForm.getInputProps("name")}
              />
              <TextInput
                label="Email"
                placeholder="you@example.com"
                {...registerForm.getInputProps("email")}
              />
              <PasswordInput
                label="Пароль"
                description="8–72 символа, буквы + цифры"
                {...registerForm.getInputProps("password")}
              />
              <Stack gap={4}>
                <Progress value={passwordStrength.score} color={passwordStrength.color} />
                <Text size="xs" c="dimmed">
                  Надежность: {passwordStrength.label}
                </Text>
              </Stack>
              <Group>
                <Button type="submit">Создать аккаунт</Button>
              </Group>
            </Stack>
          </form>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={resetOpen} onClose={() => setResetOpen(false)} title="Сброс пароля">
        <Stack>
          <TextInput
            label="Email"
            placeholder="you@example.com"
            value={resetEmail}
            onChange={(event) => setResetEmail(event.currentTarget.value)}
          />
          <Group>
            <Button onClick={requestReset}>Отправить ссылку</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
