"use client";

import { Button, Card, Group, Modal, PasswordInput, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMounted } from "@mantine/hooks";
import { AuthPanel } from "@/components/AuthPanel";
import { AccountDashboard } from "@/components/AccountDashboard";
import { Layout } from "@/components/Layout";
import { getToken } from "@/lib/auth";
import { postJson } from "@/lib/api";

export function AccountPageClient() {
  const [authTick, setAuthTick] = useState(0);
  const [newPassword, setNewPassword] = useState("");
  const searchParams = useSearchParams();
  const router = useRouter();
  const mounted = useMounted();

  const resetToken = useMemo(() => searchParams.get("reset") ?? "", [searchParams]);
  const resetOpen = !!resetToken;

  const authed = mounted && authTick >= 0 && !!getToken();

  useEffect(() => {
    const verify = searchParams.get("verify");
    if (verify) {
      postJson("/auth/verify-email", { token: verify })
        .then(() => {
          notifications.show({
            title: "Email подтвержден",
            message: "Спасибо! Почта подтверждена.",
            color: "green",
          });
        })
        .catch((error) => {
          notifications.show({
            title: "Ошибка подтверждения",
            message: error instanceof Error ? error.message : "Request failed",
            color: "red",
          });
        });
    }
  }, [searchParams]);

  const closeResetModal = () => {
    setNewPassword("");
    if (!resetToken) return;
    const params = new URLSearchParams(searchParams);
    params.delete("reset");
    const query = params.toString();
    router.replace(query ? `?${query}` : "/account");
  };

  const submitReset = async () => {
    try {
      await postJson("/auth/reset-password", {
        token: resetToken,
        new_password: newPassword,
      });
      notifications.show({
        title: "Пароль обновлен",
        message: "Теперь вы можете войти с новым паролем.",
        color: "green",
      });
      closeResetModal();
    } catch (error) {
      notifications.show({
        title: "Ошибка сброса",
        message: error instanceof Error ? error.message : "Request failed",
        color: "red",
      });
    }
  };

  if (!mounted) {
    return (
      <Layout>
        <Card withBorder radius="lg">
          Загрузка...
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <Card withBorder radius="lg">
        {authed ? (
          <AccountDashboard onLogout={() => setAuthTick((value) => value + 1)} />
        ) : (
          <AuthPanel onAuth={() => setAuthTick((value) => value + 1)} />
        )}
      </Card>

      <Modal opened={resetOpen} onClose={closeResetModal} title="Новый пароль">
        <Stack>
          <Text size="sm" c="dimmed">
            Установите новый пароль (8–72 символа, буквы + цифры).
          </Text>
          <PasswordInput
            label="Новый пароль"
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />
          <Group>
            <Button onClick={submitReset}>Сохранить</Button>
          </Group>
        </Stack>
      </Modal>
    </Layout>
  );
}
