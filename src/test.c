#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#include <stddef.h>
#include <setjmp.h>
#include <cmocka.h>

#include <netdb.h>
#include <arpa/inet.h>
#include <ares.h>

#include "resolver.h"

// State to test
typedef struct {
    char *domain;
    char *servers;
} state_type;

void debug(const char *fmt, ...) {
    const char *deb = getenv("TEST_DEBUG");
    if (deb != NULL) {
        va_list args;
        va_start(args, fmt);
        vprintf(fmt, args);
        va_end(args);
    }
}

// Tests initializes
static void setup(void **state) {
    const char *port = getenv("DNS_DNS_PORT");
    const char *host = getenv("DNS_DNS_HOST");

    // Alloc test stat
    state_type *_state = malloc(sizeof(state_type));
    assert_non_null(_state);

    // Get host ip
    struct hostent *results = gethostbyname(host);
    assert_non_null(results);

    // Get a first ip
    int i = 0;
    char ip[INET6_ADDRSTRLEN];
    for (i = 0; results->h_addr_list[i]; ++i) {
        inet_ntop(results->h_addrtype, results->h_addr_list[i], ip, sizeof(ip));
        break;
    }

    // Format servers
    int size  = sizeof(char) * (INET6_ADDRSTRLEN + strlen(port));
    _state->servers = malloc(size);
    snprintf(_state->servers, size - 1, "%s:%s", ip, port);

    // Save in state
    _state->domain  = getenv("DNS_DOMAIN");
    *state = _state;
}

static void teardown(void **state) {
    state_type *_state = *state;

    free(_state->servers);
    free(_state);
}

// Testes cases
static void gethostbyname_unknown_name_test(void **state) {
    struct hostent *results;
    state_type *_state = *state;

    results = gethostbyname(_state->domain);

    assert_null(results);
    assert_int_equal(h_errno, HOST_NOT_FOUND);
}

static void resolver_by_nameserver_test(void **state) {
    struct hostent *results;
    state_type *_state = *state;

    // equal: dig @$DNS_DNS_HOST -p$DNS_53_PORT $DNS_DOMAIN
    debug("Query %s in %s", _state->servers, _state->domain);
    results = resolver_by_servers(_state->domain, _state->servers);

    assert_non_null(results);
    assert_string_equal(results->h_name, _state->domain);
    assert_null(results->h_aliases[0]);
    assert_int_equal(results->h_addrtype, AF_INET);
    assert_int_equal(results->h_length, 4);
    assert_non_null(results->h_addr_list[0]);
    assert_null(results->h_addr_list[1]);

    ares_free_hostent(results);
}

int main(void) {
    printf("\nRun testes...\n\n");
    const UnitTest tests[] = {
        unit_test_setup_teardown(gethostbyname_unknown_name_test, setup, teardown),
        unit_test_setup_teardown(resolver_by_nameserver_test    , setup, teardown),
    };
    return run_tests(tests);
}

