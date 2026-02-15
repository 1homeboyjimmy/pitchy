"use client";

import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DatePickerInput, DatesRangeValue } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AnalysisItem,
  ChatSearchItem,
  ChatMessage,
  ChatSession,
  UserProfile,
  deleteAuth,
  getAuthJson,
  patchAuthJson,
  postAuthJson,
} from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import dayjs from "dayjs";
import { IconEdit, IconSearch, IconTrash } from "@tabler/icons-react";

type DashboardProps = {
  onLogout: () => void;
};

export function AccountDashboard({ onLogout }: DashboardProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisItem[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [analysisQuery, setAnalysisQuery] = useState("");
  const [analysisRange, setAnalysisRange] = useState<DatesRangeValue<string>>([
    dayjs().subtract(30, "day").format("YYYY-MM-DD"),
    dayjs().format("YYYY-MM-DD"),
  ]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisItem | null>(
    null
  );
  const [renameSessionId, setRenameSessionId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSearchItem[]>([]);

  const token = useMemo(() => getToken(), []);

  const fetchProfile = useCallback(async () => {
    if (!token) return;
    const data = await getAuthJson<UserProfile>("/me", token);
    setProfile(data);
  }, [token]);

  const fetchAnalyses = useCallback(async () => {
    if (!token) return;
    const data = await getAuthJson<AnalysisItem[]>("/analysis", token);
    setAnalyses(data);
  }, [token]);

  const fetchSessions = useCallback(async () => {
    if (!token) return;
    const data = await getAuthJson<ChatSession[]>("/chat/sessions", token);
    setSessions(data);
  }, [token]);

  const fetchMessages = useCallback(async (sessionId: number) => {
    if (!token) return;
    const data = await getAuthJson<ChatMessage[]>(
      `/chat/sessions/${sessionId}/messages`,
      token
    );
    setMessages(data);
  }, [token]);

  const fetchSearchResults = useCallback(async (query: string) => {
    if (!token) return;
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const data = await getAuthJson<ChatSearchItem[]>(
      `/chat/messages/search?query=${encodeURIComponent(query)}`,
      token
    );
    setSearchResults(data);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchProfile(), fetchAnalyses(), fetchSessions()]);
      } catch (error) {
        notifications.show({
          title: "Ошибка загрузки",
          message: error instanceof Error ? error.message : "Ошибка запроса",
          color: "red",
        });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, fetchProfile, fetchAnalyses, fetchSessions]);

  const handleLogout = () => {
    clearToken();
    setProfile(null);
    onLogout();
  };

  const createSession = async () => {
    if (!token || !newSessionTitle.trim()) return;
    try {
      const session = await postAuthJson<ChatSession>(
        "/chat/sessions",
        { title: newSessionTitle },
        token
      );
      setSessions((prev) => [session, ...prev]);
      setNewSessionTitle("");
      setSelectedSession(session.id);
      setMessages([]);
    } catch (error) {
      notifications.show({
        title: "Ошибка создания чата",
        message: error instanceof Error ? error.message : "Ошибка запроса",
        color: "red",
      });
    }
  };

  const renameSession = async () => {
    if (!token || !renameSessionId || !renameTitle.trim()) return;
    try {
      const session = await patchAuthJson<ChatSession>(
        `/chat/sessions/${renameSessionId}`,
        { title: renameTitle },
        token
      );
      setSessions((prev) =>
        prev.map((item) => (item.id === session.id ? session : item))
      );
      setRenameSessionId(null);
      setRenameTitle("");
    } catch (error) {
      notifications.show({
        title: "Ошибка переименования",
        message: error instanceof Error ? error.message : "Ошибка запроса",
        color: "red",
      });
    }
  };

  const removeSession = async (sessionId: number) => {
    if (!token) return;
    try {
      await deleteAuth(`/chat/sessions/${sessionId}`, token);
      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      if (selectedSession === sessionId) {
        setSelectedSession(null);
        setMessages([]);
      }
    } catch (error) {
      notifications.show({
        title: "Ошибка удаления",
        message: error instanceof Error ? error.message : "Ошибка запроса",
        color: "red",
      });
    }
  };

  const sendMessage = async () => {
    if (!token || !selectedSession || !chatInput.trim()) return;
    try {
      await postAuthJson(
        "/chat/messages",
        { session_id: selectedSession, content: chatInput },
        token
      );
      setChatInput("");
      await fetchMessages(selectedSession);
    } catch (error) {
      notifications.show({
        title: "Ошибка отправки",
        message: error instanceof Error ? error.message : "Ошибка запроса",
        color: "red",
      });
    }
  };

  useEffect(() => {
    if (selectedSession) {
      fetchMessages(selectedSession);
    }
  }, [selectedSession, fetchMessages]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchSearchResults(searchQuery);
    }, 400);
    return () => clearTimeout(timeout);
  }, [searchQuery, fetchSearchResults]);

  const filteredAnalyses = useMemo(() => {
    const [start, end] = analysisRange;
    return analyses.filter((item) => {
      const matchesQuery = analysisQuery
        ? item.market_summary.toLowerCase().includes(analysisQuery.toLowerCase())
        : true;
      const created = dayjs(item.created_at);
      const matchesStart = start ? created.isAfter(dayjs(start).startOf("day")) : true;
      const matchesEnd = end ? created.isBefore(dayjs(end).endOf("day")) : true;
      return matchesQuery && matchesStart && matchesEnd;
    });
  }, [analyses, analysisQuery, analysisRange]);

  const exportAnalyses = () => {
    const rows = [
      "id,created_at,score,market_summary",
      ...filteredAnalyses.map(
        (item) =>
          `${item.id},${item.created_at},${item.investment_score},"${item.market_summary.replace(
            /"/g,
            '""'
          )}"`
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "analyses.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (loading) {
    return (
      <Group justify="center">
        <Loader />
      </Group>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={3}>Личный кабинет</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {profile?.name} • {profile?.email}
          </Text>
        </div>
        <Group>
          {profile?.is_admin ? <Badge color="violet">Admin</Badge> : null}
          <Button variant="outline" onClick={handleLogout}>
            Выйти
          </Button>
        </Group>
      </Group>

      <Card withBorder radius="lg">
        <Title order={4}>История анализов</Title>
        <Group mt="sm" align="flex-end">
          <TextInput
            label="Поиск по summary"
            placeholder="Ключевое слово"
            value={analysisQuery}
            onChange={(event) => setAnalysisQuery(event.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <DatePickerInput
            type="range"
            label="Период"
            valueFormat="YYYY-MM-DD"
            value={analysisRange}
            onChange={setAnalysisRange}
            maxDate={new Date()}
          />
          <Button variant="outline" onClick={exportAnalyses}>
            Экспорт CSV
          </Button>
        </Group>
        {analyses.length === 0 ? (
          <Text size="sm" c="dimmed" mt="sm">
            Пока нет анализов.
          </Text>
        ) : (
          <Table striped highlightOnHover mt="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Дата</Table.Th>
                <Table.Th>Score</Table.Th>
                <Table.Th>Summary</Table.Th>
                <Table.Th>Детали</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredAnalyses.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    {new Date(item.created_at).toLocaleString()}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={item.investment_score >= 7 ? "green" : "yellow"}>
                      {item.investment_score}/10
                    </Badge>
                  </Table.Td>
                  <Table.Td>{item.market_summary}</Table.Td>
                  <Table.Td>
                    <Button variant="subtle" onClick={() => setSelectedAnalysis(item)}>
                      Подробнее
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Card withBorder radius="lg">
        <Title order={4}>Чаты</Title>
        <Group mt="sm" align="flex-end">
          <TextInput
            label="Поиск по сообщениям"
            placeholder="Введите запрос"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            style={{ flex: 1 }}
            rightSection={<IconSearch size={16} />}
          />
        </Group>
        {searchResults.length ? (
          <Paper withBorder radius="md" p="md" mt="sm">
            <Text size="sm" c="dimmed">
              Результаты поиска
            </Text>
            <ScrollArea h={140} mt="xs">
              <Stack gap="xs">
                {searchResults.map((item) => (
                  <Paper key={item.id} p="xs" withBorder>
                    <Text size="xs" c="dimmed">
                      {item.title} • {dayjs(item.created_at).format("DD.MM HH:mm")}
                    </Text>
                    <Text size="sm">{item.content}</Text>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>
          </Paper>
        ) : null}
        <Group mt="sm" align="flex-end">
          <TextInput
            label="Новый чат"
            placeholder="Название"
            value={newSessionTitle}
            onChange={(event) => setNewSessionTitle(event.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button onClick={createSession}>Создать</Button>
        </Group>

        <Group mt="md" align="flex-start">
          <Stack style={{ width: 260 }}>
            {sessions.length === 0 ? (
              <Text size="sm" c="dimmed">
                Нет чатов.
              </Text>
            ) : (
              sessions.map((session) => (
                <Group key={session.id} justify="space-between" wrap="nowrap">
                  <Button
                    variant={selectedSession === session.id ? "filled" : "light"}
                    onClick={() => setSelectedSession(session.id)}
                    style={{ flex: 1 }}
                  >
                    {session.title}
                  </Button>
                  <ActionIcon
                    variant="light"
                    onClick={() => {
                      setRenameSessionId(session.id);
                      setRenameTitle(session.title);
                    }}
                    aria-label="Rename"
                  >
                    <IconEdit size={16} />
                  </ActionIcon>
                  <ActionIcon
                    color="red"
                    variant="light"
                    onClick={() => removeSession(session.id)}
                    aria-label="Delete"
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))
            )}
          </Stack>

          <Stack style={{ flex: 1 }}>
            <Paper withBorder radius="md" p="md">
              <ScrollArea h={260}>
                <Stack gap="sm">
                  {messages.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      Выберите чат, чтобы увидеть сообщения.
                    </Text>
                  ) : (
                    messages.map((msg, idx) => (
                      <Paper
                        key={`${msg.role}-${idx}`}
                        p="sm"
                        radius="md"
                        bg={msg.role === "user" ? "blue.0" : "gray.0"}
                        style={{
                          alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                          maxWidth: "85%",
                        }}
                      >
                        <Text size="sm">{msg.content}</Text>
                      </Paper>
                    ))
                  )}
                </Stack>
              </ScrollArea>
            </Paper>
            <Group align="flex-end">
              <TextInput
                placeholder="Сообщение"
                value={chatInput}
                onChange={(event) => setChatInput(event.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button onClick={sendMessage} disabled={!selectedSession}>
                Отправить
              </Button>
            </Group>
          </Stack>
        </Group>
      </Card>

      <Modal
        opened={!!selectedAnalysis}
        onClose={() => setSelectedAnalysis(null)}
        title="Детали анализа"
      >
        {selectedAnalysis ? (
          <Stack>
            <Text size="sm" c="dimmed">
              {new Date(selectedAnalysis.created_at).toLocaleString()}
            </Text>
            <Text fw={600}>Score: {selectedAnalysis.investment_score}/10</Text>
            <Divider />
            <Text size="sm">{selectedAnalysis.market_summary}</Text>
          </Stack>
        ) : null}
      </Modal>

      <Modal
        opened={renameSessionId !== null}
        onClose={() => setRenameSessionId(null)}
        title="Переименовать чат"
      >
        <Stack>
          <TextInput
            label="Название"
            value={renameTitle}
            onChange={(event) => setRenameTitle(event.currentTarget.value)}
          />
          <Group>
            <Button onClick={renameSession}>Сохранить</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
