"use client";

import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { DatePickerInput, DatesRangeValue } from "@mantine/dates";
import { BarChart, LineChart } from "@mantine/charts";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  Analytics,
  ErrorResponse,
  TopUser,
  UserProfile,
  deleteAuth,
  getAuthJson,
  postAuthJson,
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import {
  IconCrown,
  IconDownload,
  IconLock,
  IconLockOpen,
  IconTrash,
} from "@tabler/icons-react";

export default function AdminPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [errors, setErrors] = useState<ErrorResponse | null>(null);
  const [range, setRange] = useState<DatesRangeValue<string>>([
    dayjs().subtract(6, "day").format("YYYY-MM-DD"),
    dayjs().format("YYYY-MM-DD"),
  ]);
  const [loading, setLoading] = useState(true);

  const rangeQuery = useMemo(() => {
    const [start, end] = range;
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return params.toString();
  }, [range]);

  const loadAdminData = useCallback(async (token: string) => {
    const query = rangeQuery;
    const [stats, list, top, errorList] = await Promise.all([
      getAuthJson<Analytics>(`/admin/analytics?${query}`, token),
      getAuthJson<UserProfile[]>("/admin/users", token),
      getAuthJson<TopUser[]>(`/admin/top-users?${query}&limit=10`, token),
      getAuthJson<ErrorResponse>(`/admin/errors?${query}&limit=50`, token),
    ]);
    setAnalytics(stats);
    setUsers(list);
    setTopUsers(top);
    setErrors(errorList);
  }, [rangeQuery]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        const me = await getAuthJson<UserProfile>("/me", token);
        setProfile(me);
        if (me.is_admin) {
          await loadAdminData(token);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [loadAdminData]);

  useEffect(() => {
    const token = getToken();
    if (!token || !profile?.is_admin) return;
    loadAdminData(token);
  }, [profile, loadAdminData]);

  const exportErrors = async () => {
    const token = getToken();
    if (!token) return;
    const query = rangeQuery;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/admin/errors/export?${query}`,
      {
        credentials: "include",
      }
    );
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "errors.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const blockUser = async (userId: number) => {
    const token = getToken();
    if (!token) return;
    await postAuthJson(`/admin/users/${userId}/block`, {}, token);
    loadAdminData(token);
  };

  const unblockUser = async (userId: number) => {
    const token = getToken();
    if (!token) return;
    await postAuthJson(`/admin/users/${userId}/unblock`, {}, token);
    loadAdminData(token);
  };

  const deleteUser = async (userId: number) => {
    const token = getToken();
    if (!token) return;
    await deleteAuth(`/admin/users/${userId}`, token);
    loadAdminData(token);
  };

  const makeAdmin = async (userId: number) => {
    const token = getToken();
    if (!token) return;
    await postAuthJson(`/admin/users/${userId}/make-admin`, {}, token);
    loadAdminData(token);
  };

  return (
    <Layout>
      <Card withBorder radius="lg">
        {loading ? (
          <Group justify="center">
            <Loader />
          </Group>
        ) : !profile ? (
          <Text>Требуется вход.</Text>
        ) : !profile.is_admin ? (
          <Text>Нет доступа. Требуются права администратора.</Text>
        ) : (
          <Stack>
            <Title order={3}>Админ‑панель</Title>
            <DatePickerInput
              type="range"
              label="Период"
              placeholder="Выберите диапазон"
              valueFormat="YYYY-MM-DD"
              value={range}
              onChange={setRange}
              maxDate={new Date()}
            />
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              <Card withBorder radius="md">
                <Text fw={600}>Итоги за период</Text>
                <Group mt="sm">
                  <Badge color="blue">
                    Польз.: {analytics?.totals.users ?? 0}
                  </Badge>
                  <Badge color="green">
                    Анализы: {analytics?.totals.analyses ?? 0}
                  </Badge>
                  <Badge color="violet">
                    Сессии: {analytics?.totals.chat_sessions ?? 0}
                  </Badge>
                  <Badge color="orange">
                    Сообщения: {analytics?.totals.chat_messages ?? 0}
                  </Badge>
                  <Badge color="red">Ошибки: {analytics?.totals.errors ?? 0}</Badge>
                </Group>
              </Card>
              <Card withBorder radius="md">
                <Text fw={600}>Ошибки</Text>
                <Text size="sm" c="dimmed" mt={4}>
                  Всего записей: {errors?.count ?? 0}
                </Text>
                <Button
                  mt="sm"
                  variant="light"
                  leftSection={<IconDownload size={16} />}
                  onClick={exportErrors}
                >
                  Экспорт CSV
                </Button>
              </Card>
            </SimpleGrid>

            {analytics ? (
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                <Card withBorder radius="md">
                  <Text fw={600}>Активность</Text>
                  <LineChart
                    h={240}
                    data={analytics.series}
                    dataKey="date"
                    series={[
                      { name: "users", color: "blue" },
                      { name: "analyses", color: "green" },
                      { name: "chat_messages", color: "orange" },
                    ]}
                  />
                </Card>
                <Card withBorder radius="md">
                  <Text fw={600}>Ошибки по дням</Text>
                  <BarChart
                    h={240}
                    data={analytics.series}
                    dataKey="date"
                    series={[{ name: "errors", color: "red" }]}
                  />
                </Card>
              </SimpleGrid>
            ) : null}

            <Card withBorder radius="md">
              <Text fw={600} mb="sm">
                Топ пользователей по активности
              </Text>
              {topUsers.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Нет данных.
                </Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Email</Table.Th>
                      <Table.Th>Имя</Table.Th>
                      <Table.Th>Анализы</Table.Th>
                      <Table.Th>Сообщения</Table.Th>
                      <Table.Th>Всего</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {topUsers.map((user) => (
                      <Table.Tr key={user.id}>
                        <Table.Td>{user.email}</Table.Td>
                        <Table.Td>{user.name}</Table.Td>
                        <Table.Td>{user.analyses}</Table.Td>
                        <Table.Td>{user.messages}</Table.Td>
                        <Table.Td>{user.total}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>

            <Card withBorder radius="md">
              <Text fw={600} mb="sm">
                Лог ошибок
              </Text>
              {errors?.items?.length ? (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Дата</Table.Th>
                      <Table.Th>Код</Table.Th>
                      <Table.Th>Метод</Table.Th>
                      <Table.Th>Путь</Table.Th>
                      <Table.Th>Пользователь</Table.Th>
                      <Table.Th>Детали</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {errors.items.map((err) => (
                      <Table.Tr key={err.id}>
                        <Table.Td>
                          {dayjs(err.created_at).format("YYYY-MM-DD HH:mm")}
                        </Table.Td>
                        <Table.Td>{err.status_code}</Table.Td>
                        <Table.Td>{err.method}</Table.Td>
                        <Table.Td>{err.path}</Table.Td>
                        <Table.Td>{err.user_id ?? "—"}</Table.Td>
                        <Table.Td>{err.detail}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Text size="sm" c="dimmed">
                  Ошибок за выбранный период нет.
                </Text>
              )}
            </Card>

            <Table striped highlightOnHover mt="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Имя</Table.Th>
                  <Table.Th>Админ</Table.Th>
                  <Table.Th>Активен</Table.Th>
                  <Table.Th>Подтвержден</Table.Th>
                  <Table.Th>Создан</Table.Th>
                  <Table.Th>Действия</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {users.map((user) => (
                  <Table.Tr key={user.id}>
                    <Table.Td>{user.email}</Table.Td>
                    <Table.Td>{user.name}</Table.Td>
                    <Table.Td>{user.is_admin ? "Yes" : "No"}</Table.Td>
                    <Table.Td>{user.is_active ? "Yes" : "No"}</Table.Td>
                    <Table.Td>{user.email_verified ? "Yes" : "No"}</Table.Td>
                    <Table.Td>
                      {new Date(user.created_at).toLocaleString()}
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        {!user.is_admin ? (
                          <ActionIcon
                            color="violet"
                            variant="light"
                            onClick={() => makeAdmin(user.id)}
                          >
                            <IconCrown size={16} />
                          </ActionIcon>
                        ) : null}
                        {user.is_active ? (
                          <ActionIcon
                            color="red"
                            variant="light"
                            onClick={() => blockUser(user.id)}
                          >
                            <IconLock size={16} />
                          </ActionIcon>
                        ) : (
                          <ActionIcon
                            color="green"
                            variant="light"
                            onClick={() => unblockUser(user.id)}
                          >
                            <IconLockOpen size={16} />
                          </ActionIcon>
                        )}
                        <ActionIcon
                          color="red"
                          variant="light"
                          onClick={() => deleteUser(user.id)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </Card>
    </Layout>
  );
}
